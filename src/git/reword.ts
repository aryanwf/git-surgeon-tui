import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runGitChecked, type GitCommandResult } from "./runner"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
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
  selected: SelectedRename[]
  rangeCommits: CommitSummary[]
  todo: string
  range: string
  changedCommitCount: number
}

type SelectedRename = RenameCommitMessage & {
  commit: CommitSummary
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
    return { message: { ...message, sha: commit.sha, commit }, index: commits.findIndex((candidate) => candidate.sha === commit.sha) }
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
    .map((commit) => `edit ${commit.sha} ${commit.subject}`)
    .join("\n") + "\n"

  return {
    baseCommit,
    root,
    selected,
    rangeCommits,
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
  const commands: GitCommandResult[] = []
  const selectedBySha = new Map(plan.selected.map((selected) => [selected.sha, selected]))
  const rewrittenBySha = new Map<string, string>()
  let previousNew = plan.root ? undefined : plan.baseCommit

  for (const commit of plan.rangeCommits) {
    const selected = selectedBySha.get(commit.sha)
    const treeResult = await runGitChecked({ repoPath, args: ["rev-parse", `${commit.sha}^{tree}`] })
    commands.push(treeResult)
    const message = selected ? selected.message : await commitMessage(repoPath, commit.sha, commands)
    const args = ["commit-tree", treeResult.stdout.trim()]
    if (previousNew) args.push("-p", previousNew)

    const built = await runGitChecked({ repoPath, args, env: commitEnv(commit), stdin: message })
    commands.push(built)
    const newSha = built.stdout.trim()
    if (selected) rewrittenBySha.set(selected.sha, newSha)
    previousNew = newSha
  }

  if (!previousNew) throw new Error("Rename rewrite produced no commits")
  await updateHead(repoPath, previousNew, commands, "gitsurgeon: rename-commit-messages")
  return { commands, rewrittenCommits: plan.selected.flatMap((selected) => rewrittenBySha.get(selected.sha) ?? []) }
}

async function commitMessage(repoPath: string, sha: string, commands: GitCommandResult[]): Promise<string> {
  const result = await runGitChecked({ repoPath, args: ["log", "-1", "--format=%B", sha] })
  commands.push(result)
  return result.stdout
}

function commitEnv(commit: CommitSummary): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: commit.authorName,
    GIT_AUTHOR_EMAIL: commit.authorEmail,
    GIT_AUTHOR_DATE: commit.authorDate,
    GIT_COMMITTER_NAME: commit.committerName,
    GIT_COMMITTER_EMAIL: commit.committerEmail,
    GIT_COMMITTER_DATE: commit.committerDate,
  }
}

async function updateHead(repoPath: string, newHead: string, commands: GitCommandResult[], reason: string): Promise<void> {
  const refResult = await runGitChecked({ repoPath, args: ["rev-parse", "--symbolic-full-name", "HEAD"] })
  commands.push(refResult)
  const headRef = refResult.stdout.trim()
  const oldHeadResult = await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })
  commands.push(oldHeadResult)
  const updateArgs = headRef && headRef !== "HEAD"
    ? ["update-ref", "-m", reason, headRef, newHead, oldHeadResult.stdout.trim()]
    : ["update-ref", "--no-deref", "-m", reason, "HEAD", newHead, oldHeadResult.stdout.trim()]
  const update = await runGitChecked({ repoPath, args: updateArgs })
  commands.push(update)
  const reset = await runGitChecked({ repoPath, args: ["reset", "--hard", "HEAD"], timeoutMs: 120_000 })
  commands.push(reset)
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
