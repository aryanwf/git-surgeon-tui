import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { GitCommandError, runGit, runGitChecked, type GitCommandResult } from "./runner"
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
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-author-"))
  const todoPath = join(helperDir, "todo")
  const editorPath = join(helperDir, "sequence-editor.sh")
  const commands: GitCommandResult[] = []

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(editorPath, `#!/bin/sh\ncp ${shellQuote(todoPath)} "$1"\n`)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", editorPath]).exited

    const rebaseArgs = plan.root ? ["rebase", "-i", "--root"] : ["rebase", "-i", plan.baseCommit!]
    const rebaseStart = await runGit({ repoPath, args: rebaseArgs, env: { GIT_SEQUENCE_EDITOR: editorPath }, timeoutMs: 120_000 })
    commands.push(rebaseStart)
    if (rebaseStart.exitCode !== 0 && !(await isRebaseInProgress(repoPath))) throw new GitCommandError("Interactive rebase failed to start", rebaseStart)

    const amend = await runGit({ repoPath, args: amendArgs(plan), env: amendEnv(plan), timeoutMs: 120_000 })
    commands.push(amend)
    if (amend.exitCode !== 0) throw new GitCommandError("Commit amend failed during author change flow", amend)
    const newTargetSha = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

    const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
    commands.push(cont)
    if (cont.exitCode !== 0 && (await hasConflicts(repoPath))) throw new GitCommandError("Rebase stopped with conflicts", cont)
    if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) throw new GitCommandError("Rebase continue failed", cont)

    return { commands, newTargetSha }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

function amendArgs(plan: ChangeCommitAuthorPlan): string[] {
  const args = ["commit", "--amend", "--no-edit"]
  if (plan.mode === "author" || plan.mode === "both") args.push(`--author=${plan.newName} <${plan.newEmail}>`)
  return args
}

function amendEnv(plan: ChangeCommitAuthorPlan): Record<string, string> {
  const env: Record<string, string> = {
    GIT_COMMITTER_NAME: plan.target.committerName,
    GIT_COMMITTER_EMAIL: plan.target.committerEmail,
    GIT_COMMITTER_DATE: plan.target.committerDate,
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

async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const mergePath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"] })).stdout.trim()
  const applyPath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"] })).stdout.trim()
  return existsSync(mergePath) || existsSync(applyPath)
}

async function hasConflicts(repoPath: string): Promise<boolean> {
  const result = await runGitChecked({ repoPath, args: ["diff", "--name-only", "--diff-filter=U"] })
  return result.stdout.trim() !== ""
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
