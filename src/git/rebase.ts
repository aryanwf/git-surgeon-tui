import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { GitCommandError, runGit, runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
import { buildHistoryPreview, withScratchClone, type HistoryPreview } from "./preview"

export type VisualRebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop" | "exec"

export type VisualRebaseRow = {
  sha: string
  action: VisualRebaseAction
  message?: string
  command?: string
  allowEmptyMessage?: boolean
}

export type VisualRebasePreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit: string
  commits: CommitSummary[]
  todo: string
  oldGraph: string
  newGraph: string
  finalDiff: string
  finalDiffStat: string
  finalDiffPatch: string
  oldMetadata: string
  newMetadata: string
  historyPreview: HistoryPreview
  warnings: string[]
  changedCommitCount: number
  droppedCommitIds: string[]
}

export type VisualRebaseResult = {
  preview: VisualRebasePreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type VisualRebasePlan = {
  baseCommit: string
  commits: CommitSummary[]
  rows: PlannedRow[]
  todo: string
  changedCommitCount: number
  droppedCommitIds: string[]
  editorMessages: string[]
}

type PlannedRow = VisualRebaseRow & {
  sha: string
  commit: CommitSummary
}

const TODO_ACTIONS = new Set<VisualRebaseAction>(["pick", "reword", "edit", "squash", "fixup", "drop", "exec"])

export async function visualInteractiveRebase(options: {
  repoPath: string
  base: string
  rows: VisualRebaseRow[]
  apply?: boolean
}): Promise<VisualRebaseResult> {
  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildVisualRebasePlan(state.repoPath, options.base, options.rows)
  const warnings = publicHistoryWarnings(state.upstream)
  const preview = await previewVisualRebase(state.repoPath, plan, warnings)

  if (!options.apply) {
    const operationLogPath = await writePreviewLog(state, "visual-interactive-rebase", plan.baseCommit, preview.newHead, [
      `git clone --shared --no-hardlinks ${state.repoPath} <scratch>`,
      `git rebase -i ${plan.baseCommit}`,
    ])
    return { preview, applied: false, operationLogPath }
  }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "visual-interactive-rebase")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeVisualRebase(state.repoPath, plan)
    for (const command of applyResult.commands) log.commands.push(commandLine(command))
    log.newHead = (await runGitChecked({ repoPath: state.repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
    log.finishedAt = new Date().toISOString()
    log.status = "applied"
    const operationLogPath = await writeOperationLog(state, timestamp, log)
    return { preview: { ...preview, backupRef }, applied: true, backupRef, operationLogPath }
  } catch (error) {
    log.finishedAt = new Date().toISOString()
    log.status = "failed"
    log.errors.push(error instanceof Error ? error.message : String(error))
    await writeOperationLog(state, timestamp, log)
    throw error
  }
}

export async function buildVisualRebasePlan(repoPath: string, base: string, rows: VisualRebaseRow[]): Promise<VisualRebasePlan> {
  const baseCommit = (await runGitChecked({ repoPath, args: ["rev-parse", "--verify", base] })).stdout.trim()
  const commits = await listCommits(repoPath, `${baseCommit}..HEAD`)
  if (commits.length === 0) throw new Error(`No commits found after base ${base}`)

  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const plannedRows = rows.length === 0
    ? commits.map((commit) => ({ sha: commit.sha, action: "pick" as const, commit }))
    : rows.map((row) => {
      if (!TODO_ACTIONS.has(row.action)) throw new Error(`Unsupported rebase action: ${row.action}`)
      const commit = bySha.get(row.sha)
      if (!commit) throw new Error(`Commit ${row.sha} is not in ${base}..HEAD`)
      return { ...row, sha: commit.sha, commit }
    })

  validateRows(commits, plannedRows)
  const mergeInRange = commits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const editorMessages = plannedRows.flatMap((row) => {
    if (row.action !== "reword" && row.action !== "squash") return []
    const message = row.message ?? row.commit.subject
    if (message === "" && !row.allowEmptyMessage) throw new Error(`Empty message for ${row.commit.shortSha} requires allowEmptyMessage`)
    return [message]
  })

  const todo = plannedRows.map(todoLine).join("\n") + "\n"

  return {
    baseCommit,
    commits,
    rows: plannedRows,
    todo,
    changedCommitCount: commits.length,
    droppedCommitIds: plannedRows.filter((row) => row.action === "drop").map((row) => row.sha),
    editorMessages,
  }
}

async function previewVisualRebase(repoPath: string, plan: VisualRebasePlan, warnings: string[]): Promise<VisualRebasePreview> {
  return await withScratchClone(repoPath, async (scratch) => {
    await executeVisualRebase(scratch.repoPath, plan)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch.repoPath, range: `${plan.baseCommit}..HEAD` })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
      commits: plan.commits,
      todo: plan.todo,
      oldGraph: historyPreview.oldGraph,
      newGraph: historyPreview.newGraph,
      finalDiff: historyPreview.diffStat,
      finalDiffStat: historyPreview.diffStat,
      finalDiffPatch: historyPreview.diffPatch,
      oldMetadata: historyPreview.oldMetadata,
      newMetadata: historyPreview.newMetadata,
      historyPreview,
      warnings,
      changedCommitCount: plan.changedCommitCount,
      droppedCommitIds: plan.droppedCommitIds,
    }
  })
}

async function writePreviewLog(state: Awaited<ReturnType<typeof validateRepository>>, operationType: string, baseCommit: string, newHead: string, commands: string[]): Promise<string> {
  const timestamp = timestampForRef()
  const log = await buildOperationLog(state, operationType)
  log.baseCommit = baseCommit
  log.newHead = newHead
  log.commands = commands
  log.status = "previewed"
  log.finishedAt = new Date().toISOString()
  return await writeOperationLog(state, timestamp, log)
}

async function executeVisualRebase(repoPath: string, plan: VisualRebasePlan): Promise<{ commands: GitCommandResult[] }> {
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-rebase-"))
  const todoPath = join(helperDir, "todo")
  const sequenceEditorPath = join(helperDir, "sequence-editor.sh")
  const messageEditorPath = join(helperDir, "message-editor.sh")
  const commands: GitCommandResult[] = []

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(sequenceEditorPath, `#!/bin/sh\ncp ${shellQuote(todoPath)} "$1"\n`)
    await writeMessageEditor(helperDir, messageEditorPath, plan.editorMessages)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", sequenceEditorPath]).exited
    await Bun.spawn(["chmod", "+x", messageEditorPath]).exited

    const rebase = await runGit({
      repoPath,
      args: ["rebase", "-i", plan.baseCommit],
      env: { GIT_SEQUENCE_EDITOR: sequenceEditorPath, GIT_EDITOR: messageEditorPath },
      timeoutMs: 120_000,
    })
    commands.push(rebase)
    if (rebase.exitCode !== 0 && !(await isRebaseInProgress(repoPath))) throw new GitCommandError("Visual interactive rebase failed", rebase)

    while (await isRebaseInProgress(repoPath)) {
      if (await hasConflicts(repoPath)) throw new GitCommandError("Rebase stopped with conflicts", rebase)
      const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: messageEditorPath }, timeoutMs: 120_000 })
      commands.push(cont)
      if (cont.exitCode !== 0 && (await hasConflicts(repoPath))) throw new GitCommandError("Rebase stopped with conflicts", cont)
      if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) throw new GitCommandError("Rebase continue failed", cont)
    }

    return { commands }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

async function writeMessageEditor(helperDir: string, editorPath: string, messages: string[]): Promise<void> {
  const counterPath = join(helperDir, "message-count")
  await Bun.write(counterPath, "0\n")
  for (const [index, message] of messages.entries()) {
    await Bun.write(join(helperDir, `message-${index}`), message)
  }
  const cases = messages.map((_, index) => `${index}) cp ${shellQuote(join(helperDir, `message-${index}`))} "$1" ;;`).join("\n")
  await Bun.write(editorPath, `#!/bin/sh\ncount=$(cat ${shellQuote(counterPath)})\ncase "$count" in\n${cases}\n*) exit 0 ;;\nesac\nexpr "$count" + 1 > ${shellQuote(counterPath)}\n`)
}

function validateRows(commits: CommitSummary[], rows: PlannedRow[]): void {
  const expected = new Set(commits.map((commit) => commit.sha))
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.sha)) throw new Error(`Commit ${row.commit.shortSha} appears more than once in the rebase todo`)
    seen.add(row.sha)
    if (row.action === "exec" && !row.command) throw new Error(`Exec row after ${row.commit.shortSha} requires a command`)
    if (row.action !== "exec" && row.command) throw new Error(`Only exec rows can include a command`)
  }
  if (rows[0]?.action === "squash" || rows[0]?.action === "fixup") {
    throw new Error("The first rebase row cannot be squash or fixup")
  }
  const missing = [...expected].filter((sha) => !seen.has(sha))
  if (missing.length > 0) throw new Error(`Rebase todo must include every commit in the selected range; missing: ${missing.join(", ")}`)
}

function todoLine(row: PlannedRow): string {
  if (row.action === "exec") return `pick ${row.sha} ${row.commit.subject}\nexec ${row.command}`
  return `${row.action} ${row.sha} ${row.commit.subject}`
}

async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const mergePath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"] })).stdout.trim()
  const applyPath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"] })).stdout.trim()
  return existsSync(mergePath) || existsSync(applyPath)
}

async function hasConflicts(repoPath: string): Promise<boolean> {
  const result = await runGitChecked({ repoPath, args: ["diff", "--name-only", "--diff-filter=U"] })
  return result.stdout.trim() !== ""
}

function publicHistoryWarnings(upstream?: string): string[] {
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits may require coordinated force-push later.`] : []
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
