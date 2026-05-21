import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { runGit, runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
import { buildHistoryPreview, historyRange, type HistoryPreview } from "./preview"

export type AuthorChangeMode = "author" | "committer" | "both"

export type ChangeCommitAuthorPreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
  targetCommit: CommitSummary
  newName: string
  newEmail: string
  mode: AuthorChangeMode
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

export type ChangeCommitAuthorResult = {
  preview: ChangeCommitAuthorPreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type ChangeCommitAuthorPlan = {
  target: CommitSummary
  rangeCommits: CommitSummary[]
  newName: string
  newEmail: string
  mode: AuthorChangeMode
  baseCommit?: string
  root: boolean
  todo: string
  changedCommitCount: number
}

export async function changeCommitAuthor(options: {
  repoPath: string
  sha: string
  name: string
  email: string
  mode: AuthorChangeMode
  apply?: boolean
}): Promise<ChangeCommitAuthorResult> {
  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildChangeCommitAuthorPlan(state.repoPath, options.sha, options.name, options.email, options.mode)
  const warnings = [...publicHistoryWarnings(state.upstream), ...attributionWarnings()]
  const preview = await previewChangeCommitAuthor(state.repoPath, plan, warnings)

  if (!options.apply) return { preview, applied: false }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "change-commit-author")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeChangeCommitAuthorRewrite(state.repoPath, plan)
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

export async function buildChangeCommitAuthorPlan(repoPath: string, sha: string, name: string, email: string, mode: AuthorChangeMode): Promise<ChangeCommitAuthorPlan> {
  validateAuthorChangeMode(mode)
  validateAuthorInput(name, email)
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const target = bySha.get(sha)
  if (!target) throw new Error(`Commit ${sha} is not reachable from HEAD`)
  if (target.parents.length > 1) throw new Error(`Merge commit ${target.shortSha} cannot have author changed in v1`)

  const targetIndex = commits.findIndex((commit) => commit.sha === target.sha)
  const rangeCommits = commits.slice(targetIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const root = target.parents.length === 0
  const baseCommit = root ? undefined : target.parents[0]
  const todo = rangeCommits.map((commit) => `${commit.sha === target.sha ? "edit" : "pick"} ${commit.sha} ${commit.subject}`).join("\n") + "\n"

  return {
    target,
    rangeCommits,
    newName: name,
    newEmail: email,
    mode,
    baseCommit,
    root,
    todo,
    changedCommitCount: rangeCommits.length,
  }
}

async function previewChangeCommitAuthor(repoPath: string, plan: ChangeCommitAuthorPlan, warnings: string[]): Promise<ChangeCommitAuthorPreview> {
  const tmp = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratch = join(tmp, "repo")
  try {
    await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratch] })
    const oldLog = await verificationLog(repoPath)
    const rewrite = await executeChangeCommitAuthorRewrite(scratch, plan)
    const newLog = await verificationLog(scratch)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
      targetCommit: plan.target,
      newName: plan.newName,
      newEmail: plan.newEmail,
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

async function executeChangeCommitAuthorRewrite(repoPath: string, plan: ChangeCommitAuthorPlan): Promise<{ commands: GitCommandResult[]; newTargetSha: string }> {
  const commands: GitCommandResult[] = []

  // Rebuild the chain commit-by-commit using `git commit-tree`. This preserves
  // every metadata field (author name/email/date AND committer name/email/date)
  // exactly for every non-target commit, and applies the requested change only
  // to the target. Interactive rebase cannot do this — `rebase --continue`
  // always rewrites the committer identity to the current Git user and the
  // committer date to "now" for re-applied commits.
  let previousNew: string | undefined = plan.root ? undefined : plan.baseCommit
  let newTargetSha = ""

  for (const commit of plan.rangeCommits) {
    const isTarget = commit.sha === plan.target.sha
    const treeResult = await runGitChecked({ repoPath, args: ["rev-parse", `${commit.sha}^{tree}`] })
    commands.push(treeResult)
    const tree = treeResult.stdout.trim()

    const messageResult = await runGitChecked({ repoPath, args: ["log", "-1", "--format=%B", commit.sha] })
    commands.push(messageResult)
    // `git log --format=%B` adds a trailing newline that `commit-tree` will
    // normalize into the canonical "single trailing newline" form on its own.
    const message = messageResult.stdout

    const env = buildCommitEnv(commit, plan, isTarget)
    const args = ["commit-tree", tree]
    if (previousNew) args.push("-p", previousNew)

    const built = await runGitChecked({ repoPath, args, env, stdin: message })
    commands.push(built)
    const newSha = built.stdout.trim()
    if (isTarget) newTargetSha = newSha
    previousNew = newSha
  }

  if (!previousNew) throw new Error("Author rewrite produced no commits")

  const refResult = await runGitChecked({ repoPath, args: ["rev-parse", "--symbolic-full-name", "HEAD"] })
  commands.push(refResult)
  const headRef = refResult.stdout.trim()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  if (headRef && headRef !== "HEAD") {
    const update = await runGitChecked({ repoPath, args: ["update-ref", "-m", "gitsurgeon: change-commit-author", headRef, previousNew, oldHead] })
    commands.push(update)
  } else {
    const update = await runGitChecked({ repoPath, args: ["update-ref", "--no-deref", "-m", "gitsurgeon: change-commit-author", "HEAD", previousNew, oldHead] })
    commands.push(update)
  }

  // Trees are identical across the rewrite, so this just refreshes the index
  // and HEAD pointer without touching working-tree contents.
  const reset = await runGit({ repoPath, args: ["reset", "--hard", "HEAD"], timeoutMs: 120_000 })
  commands.push(reset)

  return { commands, newTargetSha }
}

function buildCommitEnv(commit: CommitSummary, plan: ChangeCommitAuthorPlan, isTarget: boolean): Record<string, string> {
  const env: Record<string, string> = {
    GIT_AUTHOR_NAME: commit.authorName,
    GIT_AUTHOR_EMAIL: commit.authorEmail,
    GIT_AUTHOR_DATE: commit.authorDate,
    GIT_COMMITTER_NAME: commit.committerName,
    GIT_COMMITTER_EMAIL: commit.committerEmail,
    GIT_COMMITTER_DATE: commit.committerDate,
  }
  if (!isTarget) return env

  if (plan.mode === "author" || plan.mode === "both") {
    env.GIT_AUTHOR_NAME = plan.newName
    env.GIT_AUTHOR_EMAIL = plan.newEmail
  }
  if (plan.mode === "committer" || plan.mode === "both") {
    env.GIT_COMMITTER_NAME = plan.newName
    env.GIT_COMMITTER_EMAIL = plan.newEmail
  }
  return env
}

async function verificationLog(repoPath: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["log", "--format=%h %aI %an <%ae> %cn <%ce> %s", "-n", "20"] })).stdout
}

function validateAuthorChangeMode(mode: string): asserts mode is AuthorChangeMode {
  if (mode !== "author" && mode !== "committer" && mode !== "both") throw new Error(`Unsupported author mode: ${mode}`)
}

export function validateAuthorInput(name: string, email: string): void {
  if (name.trim() === "") throw new Error("Author name must not be empty")
  if (!email.includes("@")) throw new Error("Author email must contain @")
}

function publicHistoryWarnings(upstream?: string): string[] {
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits may require coordinated force-push later.`] : []
}

function attributionWarnings(): string[] {
  return ["This operation rewrites attribution metadata. Changing authorship is permanent and visible to all future readers of this repository."]
}


