import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeIsoDate, type DateChangeMode } from "./date"
import { getHeadCommits, type CommitSummary } from "./log"
import { buildHistoryPreview, historyRange, withScratchClone, type HistoryPreview } from "./preview"
import { assertRewriteReady, validateRepository } from "./repository"
import { GitCommandError, runGit, runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"

export type HistoryEditOperation = {
  sha: string
  message?: string
  date?: string
  dateMode?: DateChangeMode
  drop?: boolean
  allowEmptyMessage?: boolean
}

export type HistoryEditPreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
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
  affectedCommits: CommitSummary[]
  descendants: CommitSummary[]
  oldToNew: Record<string, string>
}

export type HistoryEditResult = {
  preview: HistoryEditPreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type PlannedEdit = Required<Pick<HistoryEditOperation, "sha">> & {
  commit: CommitSummary
  message?: string
  date?: string
  dateMode?: DateChangeMode
  drop: boolean
  allowEmptyMessage?: boolean
}

type HistoryEditPlan = {
  baseCommit?: string
  root: boolean
  edits: PlannedEdit[]
  rangeCommits: CommitSummary[]
  descendants: CommitSummary[]
  todo: string
  changedCommitCount: number
  droppedCommitIds: string[]
}

export async function editCommitHistory(options: {
  repoPath: string
  operations: HistoryEditOperation[]
  apply?: boolean
}): Promise<HistoryEditResult> {
  if (options.operations.length === 0) throw new Error("At least one history edit is required")

  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildHistoryEditPlan(state.repoPath, options.operations)
  const warnings = publicHistoryWarnings(state.upstream)
  const preview = await previewHistoryEdit(state.repoPath, plan, warnings)

  if (!options.apply) {
    const operationLogPath = await writePreviewLog(state, "combined-history-edit", plan.baseCommit, preview.newHead, [
      `git clone --shared --no-hardlinks ${state.repoPath} <scratch>`,
      plan.root ? "git rebase -i --root" : `git rebase -i ${plan.baseCommit}`,
    ])
    return { preview, applied: false, operationLogPath }
  }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "combined-history-edit")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeHistoryEdit(state.repoPath, plan)
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

export async function buildHistoryEditPlan(repoPath: string, operations: HistoryEditOperation[]): Promise<HistoryEditPlan> {
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const byFullSha = new Map<string, PlannedEdit>()

  for (const operation of operations) {
    const commit = bySha.get(operation.sha)
    if (!commit) throw new Error(`Commit ${operation.sha} is not reachable from HEAD`)
    if (commit.parents.length > 1) throw new Error(`Merge commit ${commit.shortSha} cannot be edited in v1`)
    if (operation.drop && (operation.message !== undefined || operation.date !== undefined)) {
      throw new Error(`Commit ${commit.shortSha} cannot be dropped and edited at the same time`)
    }
    if (operation.message === "" && !operation.allowEmptyMessage) throw new Error(`Empty message for ${commit.shortSha} requires allowEmptyMessage`)

    byFullSha.set(commit.sha, {
      sha: commit.sha,
      commit,
      message: operation.message,
      date: operation.date === undefined ? undefined : normalizeIsoDate(operation.date),
      dateMode: operation.dateMode ?? "both",
      drop: operation.drop ?? false,
      allowEmptyMessage: operation.allowEmptyMessage,
    })
  }

  const edits = [...byFullSha.values()].sort((left, right) => commits.findIndex((commit) => commit.sha === left.sha) - commits.findIndex((commit) => commit.sha === right.sha))
  const oldestEdit = edits[0]?.commit
  if (!oldestEdit) throw new Error("At least one history edit is required")
  const oldestIndex = commits.findIndex((commit) => commit.sha === oldestEdit.sha)
  const rangeCommits = commits.slice(oldestIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const root = oldestEdit.parents.length === 0
  const baseCommit = root ? undefined : oldestEdit.parents[0]
  const editMap = new Map(edits.map((edit) => [edit.sha, edit]))
  const firstDroppedIndex = rangeCommits.findIndex((commit) => editMap.get(commit.sha)?.drop)
  const descendants = firstDroppedIndex < 0 ? [] : rangeCommits.slice(firstDroppedIndex + 1)
  const todo = rangeCommits.map((commit) => {
    const edit = editMap.get(commit.sha)
    if (!edit) return `pick ${commit.sha} ${commit.subject}`
    if (edit.drop) return `drop ${commit.sha} ${commit.subject}`
    return `edit ${commit.sha} ${commit.subject}`
  }).join("\n") + "\n"

  return {
    baseCommit,
    root,
    edits,
    rangeCommits,
    descendants,
    todo,
    changedCommitCount: rangeCommits.length,
    droppedCommitIds: edits.filter((edit) => edit.drop).map((edit) => edit.sha),
  }
}

async function previewHistoryEdit(repoPath: string, plan: HistoryEditPlan, warnings: string[]): Promise<HistoryEditPreview> {
  return await withScratchClone(repoPath, async (scratch) => {
    const rewrite = await executeHistoryEdit(scratch.repoPath, plan)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch.repoPath, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
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
      affectedCommits: plan.rangeCommits,
      descendants: plan.descendants,
      oldToNew: rewrite.oldToNew,
    }
  })
}

async function executeHistoryEdit(repoPath: string, plan: HistoryEditPlan): Promise<{ commands: GitCommandResult[]; oldToNew: Record<string, string> }> {
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-history-edit-"))
  const todoPath = join(helperDir, "todo")
  const editorPath = join(helperDir, "sequence-editor.sh")
  const commands: GitCommandResult[] = []
  const editQueue = plan.edits.filter((edit) => !edit.drop)
  const oldToNew: Record<string, string> = {}

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(editorPath, `#!/bin/sh\ncp ${shellQuote(todoPath)} "$1"\n`)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", editorPath]).exited

    const rebaseArgs = plan.root ? ["rebase", "-i", "--root"] : ["rebase", "-i", plan.baseCommit!]
    const rebaseStart = await runGit({ repoPath, args: rebaseArgs, env: { GIT_SEQUENCE_EDITOR: editorPath }, timeoutMs: 120_000 })
    commands.push(rebaseStart)
    if (rebaseStart.exitCode !== 0 && !(await isRebaseInProgress(repoPath))) throw new GitCommandError("Interactive history edit failed to start", rebaseStart)

    while (await isRebaseInProgress(repoPath)) {
      if (await hasConflicts(repoPath)) throw new GitCommandError("Rebase stopped with conflicts", commands.at(-1) ?? rebaseStart)
      const edit = editQueue.shift()
      if (!edit) {
        const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
        commands.push(cont)
        if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) throw new GitCommandError("Rebase continue failed", cont)
        continue
      }

      const amend = await runGit({ repoPath, args: await amendArgs(helperDir, edit), env: amendEnv(edit), timeoutMs: 120_000 })
      commands.push(amend)
      if (amend.exitCode !== 0) throw new GitCommandError("Commit amend failed during history edit", amend)
      oldToNew[edit.sha] = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

      const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
      commands.push(cont)
      if (cont.exitCode !== 0 && (await hasConflicts(repoPath))) throw new GitCommandError("Rebase stopped with conflicts", cont)
      if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) throw new GitCommandError("Rebase continue failed", cont)
    }

    return { commands, oldToNew }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

async function amendArgs(helperDir: string, edit: PlannedEdit): Promise<string[]> {
  const args = ["commit", "--amend"]
  if (edit.message !== undefined) {
    const messagePath = join(helperDir, `${edit.sha}.message`)
    await Bun.write(messagePath, edit.message)
    args.push("-F", messagePath)
    if (edit.message === "") args.push("--allow-empty-message")
  } else {
    args.push("--no-edit")
  }
  if (edit.date && (edit.dateMode === "author" || edit.dateMode === "both")) args.push(`--date=${edit.date}`)
  return args
}

function amendEnv(edit: PlannedEdit): Record<string, string> {
  const env = {
    GIT_COMMITTER_NAME: edit.commit.committerName,
    GIT_COMMITTER_EMAIL: edit.commit.committerEmail,
    GIT_COMMITTER_DATE: edit.commit.committerDate,
  }
  if (edit.date && (edit.dateMode === "committer" || edit.dateMode === "both")) env.GIT_COMMITTER_DATE = edit.date
  return env
}

async function writePreviewLog(state: Awaited<ReturnType<typeof validateRepository>>, operationType: string, baseCommit: string | undefined, newHead: string, commands: string[]): Promise<string> {
  const timestamp = timestampForRef()
  const log = await buildOperationLog(state, operationType)
  log.baseCommit = baseCommit
  log.newHead = newHead
  log.commands = commands
  log.status = "previewed"
  log.finishedAt = new Date().toISOString()
  return await writeOperationLog(state, timestamp, log)
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
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits requires typing an explicit confirmation phrase before apply.`] : []
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
