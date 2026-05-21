import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runGit, runGitChecked, GitCommandError, type GitCommandResult } from "./runner"
import { getHeadCommits } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog, type OperationLog } from "./safety"
import { buildHistoryPreview, historyRange, type HistoryPreview } from "./preview"

export type RenameCommitMessage = {
  sha: string
  message: string
  allowEmptyMessage?: boolean
}

export type RenamePreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
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
  oldToNew: Record<string, string>
}

export type RenameResult = {
  preview: RenamePreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type RewritePlan = {
  baseCommit?: string
  root: boolean
  selected: RenameCommitMessage[]
  todo: string
  range: string
  changedCommitCount: number
}

export async function renameOldCommitMessages(options: {
  repoPath: string
  messages: RenameCommitMessage[]
  apply?: boolean
}): Promise<RenameResult> {
  if (options.messages.length === 0) throw new Error("At least one commit message is required")

  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildRenamePlan(state.repoPath, options.messages)
  const warnings = [...publicHistoryWarnings(state.upstream), ...emptyMessageWarnings(options.messages)]
  const preview = await previewRename(state.repoPath, plan, warnings)

  if (!options.apply) return { preview, applied: false }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "rename-commit-messages")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeRenameRewrite(state.repoPath, plan)
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

export async function buildRenamePlan(repoPath: string, messages: RenameCommitMessage[]): Promise<RewritePlan> {
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const selectedWithIndex = messages.map((message) => {
    const commit = bySha.get(message.sha)
    if (!commit) throw new Error(`Commit ${message.sha} is not reachable from HEAD`)
    if (commit.parents.length > 1) throw new Error(`Merge commit ${commit.shortSha} cannot be renamed in v1`)
    if (message.message === "" && !message.allowEmptyMessage) {
      throw new Error(`Empty message for ${commit.shortSha} requires allowEmptyMessage`)
    }
    return { message: { ...message, sha: commit.sha }, index: commits.findIndex((candidate) => candidate.sha === commit.sha) }
  })
  const selected = selectedWithIndex.sort((left, right) => left.index - right.index).map((item) => item.message)
  const selectedShas = new Set(selected.map((message) => message.sha))
  const oldestSelectedIndex = commits.findIndex((commit) => selectedShas.has(commit.sha))
  if (oldestSelectedIndex === -1) throw new Error("No selected commits are reachable from HEAD")

  const oldestSelected = commits[oldestSelectedIndex]
  const root = oldestSelected.parents.length === 0
  const baseCommit = root ? undefined : oldestSelected.parents[0]
  const rangeCommits = commits.slice(oldestSelectedIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const todo = rangeCommits
    .map((commit) => `${selectedShas.has(commit.sha) ? "edit" : "pick"} ${commit.sha} ${commit.subject}`)
    .join("\n") + "\n"

  return {
    baseCommit,
    root,
    selected,
    todo,
    range: root ? "HEAD" : `${baseCommit}..HEAD`,
    changedCommitCount: rangeCommits.length,
  }
}

async function previewRename(repoPath: string, plan: RewritePlan, warnings: string[]): Promise<RenamePreview> {
  const tmp = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratch = join(tmp, "repo")
  try {
    await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratch] })
    const rewrite = await executeRenameRewrite(scratch, plan)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
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
      oldToNew: buildOldToNewMap(plan, rewrite.rewrittenCommits),
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function executeRenameRewrite(repoPath: string, plan: RewritePlan): Promise<{ commands: GitCommandResult[]; rewrittenCommits: string[] }> {
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-reword-"))
  const todoPath = join(helperDir, "todo")
  const editorPath = join(helperDir, "sequence-editor.sh")
  const commands: GitCommandResult[] = []
  const rewrittenCommits: string[] = []

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(editorPath, `#!/bin/sh\ncp "${todoPath}" "$1"\n`)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", editorPath]).exited

    const rebaseArgs = plan.root ? ["rebase", "-i", "--root"] : ["rebase", "-i", plan.baseCommit!]
    const rebaseStart = await runGit({ repoPath, args: rebaseArgs, env: { GIT_SEQUENCE_EDITOR: editorPath }, timeoutMs: 120_000 })
    commands.push(rebaseStart)
    if (rebaseStart.exitCode !== 0 && !(await isRebaseInProgress(repoPath))) throw new GitCommandError("Interactive rebase failed to start", rebaseStart)

    for (const selected of plan.selected) {
      if (!(await isRebaseInProgress(repoPath))) break
      const messagePath = join(helperDir, `${selected.sha}.message`)
      await Bun.write(messagePath, selected.message)
      const amendArgs = ["commit", "--amend", "-F", messagePath]
      if (selected.message === "") amendArgs.push("--allow-empty-message")
      const amend = await runGit({ repoPath, args: amendArgs, timeoutMs: 120_000 })
      commands.push(amend)
      if (amend.exitCode !== 0) throw new GitCommandError("Commit amend failed during rename flow", amend)
      rewrittenCommits.push((await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim())

      const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
      commands.push(cont)
      if (cont.exitCode !== 0 && (await hasConflicts(repoPath))) {
        throw new GitCommandError("Rebase stopped with conflicts", cont)
      }
      if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) {
        throw new GitCommandError("Rebase continue failed", cont)
      }
    }

    if (await isRebaseInProgress(repoPath)) {
      const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
      commands.push(cont)
      if (cont.exitCode !== 0) throw new GitCommandError("Final rebase continue failed", cont)
    }

    return { commands, rewrittenCommits }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
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

function emptyMessageWarnings(messages: RenameCommitMessage[]): string[] {
  return messages.some((message) => message.message === "") ? ["At least one selected commit will have an empty message."] : []
}

function buildOldToNewMap(plan: RewritePlan, rewrittenCommits: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [index, selected] of plan.selected.entries()) {
    if (rewrittenCommits[index]) map[selected.sha] = rewrittenCommits[index]
  }
  return map
}
