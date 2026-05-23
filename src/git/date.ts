import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
import { buildHistoryPreview, historyRange, type HistoryPreview } from "./preview"

export type DateChangeMode = "author" | "committer" | "both"

export type ChangeCommitDatePreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
  targetCommit: CommitSummary
  newDate: string
  mode: DateChangeMode
  oldLog: string
  newLog: string
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

export type ChangeCommitDateResult = {
  preview: ChangeCommitDatePreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type ChangeCommitDatePlan = {
  target: CommitSummary
  newDate: string
  mode: DateChangeMode
  baseCommit?: string
  root: boolean
  todo: string
  changedCommitCount: number
}

export async function changeOldCommitDate(options: {
  repoPath: string
  sha: string
  date: string
  mode: DateChangeMode
  apply?: boolean
}): Promise<ChangeCommitDateResult> {
  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildChangeCommitDatePlan(state.repoPath, options.sha, options.date, options.mode)
  const warnings = publicHistoryWarnings(state.upstream)
  const preview = await previewChangeCommitDate(state.repoPath, plan, warnings)

  if (!options.apply) return { preview, applied: false }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "change-commit-date")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeChangeCommitDateRewrite(state.repoPath, plan)
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

export async function buildChangeCommitDatePlan(repoPath: string, sha: string, date: string, mode: DateChangeMode): Promise<ChangeCommitDatePlan> {
  validateDateChangeMode(mode)
  const newDate = normalizeIsoDate(date)
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const target = bySha.get(sha)
  if (!target) throw new Error(`Commit ${sha} is not reachable from HEAD`)
  if (target.parents.length > 1) throw new Error(`Merge commit ${target.shortSha} cannot have dates changed in v1`)

  const targetIndex = commits.findIndex((commit) => commit.sha === target.sha)
  const rangeCommits = commits.slice(targetIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const root = target.parents.length === 0
  const baseCommit = root ? undefined : target.parents[0]
  const todo = rangeCommits.map((commit) => `${commit.sha === target.sha ? "edit" : "pick"} ${commit.sha} ${commit.subject}`).join("\n") + "\n"

  return {
    target,
    newDate,
    mode,
    baseCommit,
    root,
    todo,
    changedCommitCount: rangeCommits.length,
  }
}

async function previewChangeCommitDate(repoPath: string, plan: ChangeCommitDatePlan, warnings: string[]): Promise<ChangeCommitDatePreview> {
  const tmp = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratch = join(tmp, "repo")
  try {
    await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratch] })
    const oldLog = await verificationLog(repoPath)
    const rewrite = await executeChangeCommitDateRewrite(scratch, plan)
    const newLog = await verificationLog(scratch)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
      targetCommit: plan.target,
      newDate: plan.newDate,
      mode: plan.mode,
      oldLog,
      newLog,
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
      oldToNew: { [plan.target.sha]: rewrite.newTargetSha },
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function executeChangeCommitDateRewrite(repoPath: string, plan: ChangeCommitDatePlan): Promise<{ commands: GitCommandResult[]; newTargetSha: string }> {
  const commands: GitCommandResult[] = []
  const commits = await getHeadCommits(repoPath)
  const targetIndex = commits.findIndex((commit) => commit.sha === plan.target.sha)
  if (targetIndex < 0) throw new Error(`Commit ${plan.target.sha} is not reachable from HEAD`)
  const rangeCommits = commits.slice(targetIndex)
  let previousNew = plan.root ? undefined : plan.baseCommit
  let newTargetSha = ""

  for (const commit of rangeCommits) {
    const isTarget = commit.sha === plan.target.sha
    const treeResult = await runGitChecked({ repoPath, args: ["rev-parse", `${commit.sha}^{tree}`] })
    commands.push(treeResult)
    const message = await commitMessage(repoPath, commit.sha, commands)
    const args = ["commit-tree", treeResult.stdout.trim()]
    if (previousNew) args.push("-p", previousNew)

    const built = await runGitChecked({ repoPath, args, env: commitEnv(commit, plan, isTarget), stdin: message })
    commands.push(built)
    const newSha = built.stdout.trim()
    if (isTarget) newTargetSha = newSha
    previousNew = newSha
  }

  if (!previousNew || !newTargetSha) throw new Error("Date rewrite produced no commits")
  await updateHead(repoPath, previousNew, commands, "gitsurgeon: change-commit-date")
  return { commands, newTargetSha }
}

async function commitMessage(repoPath: string, sha: string, commands: GitCommandResult[]): Promise<string> {
  const result = await runGitChecked({ repoPath, args: ["log", "-1", "--format=%B", sha] })
  commands.push(result)
  return result.stdout
}

function commitEnv(commit: CommitSummary, plan: ChangeCommitDatePlan, isTarget: boolean): Record<string, string> {
  const env = {
    GIT_AUTHOR_NAME: commit.authorName,
    GIT_AUTHOR_EMAIL: commit.authorEmail,
    GIT_AUTHOR_DATE: commit.authorDate,
    GIT_COMMITTER_NAME: commit.committerName,
    GIT_COMMITTER_EMAIL: commit.committerEmail,
    GIT_COMMITTER_DATE: commit.committerDate,
  }
  if (!isTarget) return env
  if (plan.mode === "author" || plan.mode === "both") env.GIT_AUTHOR_DATE = plan.newDate
  if (plan.mode === "committer" || plan.mode === "both") env.GIT_COMMITTER_DATE = plan.newDate
  return env
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

async function verificationLog(repoPath: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["log", "--format=%h %aI %cI %an <%ae> %cn <%ce> %s", "-n", "20"] })).stdout
}

function validateDateChangeMode(mode: string): asserts mode is DateChangeMode {
  if (mode !== "author" && mode !== "committer" && mode !== "both") throw new Error(`Unsupported date mode: ${mode}`)
}

export function normalizeIsoDate(date: string): string {
  const timestamp = Date.parse(date)
  if (Number.isNaN(timestamp)) throw new Error("Date must be a valid ISO 8601 timestamp")
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(date)) throw new Error("Date must include a timezone offset")
  return new Date(timestamp).toISOString()
}

function publicHistoryWarnings(upstream?: string): string[] {
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits may require coordinated force-push later.`] : []
}
