import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { GitCommandError, runGit, runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
import { buildHistoryPreview, historyRange, type HistoryPreview } from "./preview"

export type SplitCommitPart = {
  message: string
  paths: string[]
  allowEmptyMessage?: boolean
}

export type SplitCommitPreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
  targetCommit: CommitSummary
  changedPaths: string[]
  splitCommitIds: string[]
  descendants: CommitSummary[]
  targetDiff: string
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
}

export type SplitCommitDetails = {
  target: CommitSummary
  changedPaths: string[]
  descendants: CommitSummary[]
}

export type SplitCommitResult = {
  preview: SplitCommitPreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type SplitCommitPlan = {
  target: CommitSummary
  baseCommit?: string
  root: boolean
  descendants: CommitSummary[]
  parts: SplitCommitPart[]
  changedPaths: string[]
  todo: string
  changedCommitCount: number
}

export async function splitSingleCommit(options: { repoPath: string; sha: string; parts: SplitCommitPart[]; apply?: boolean }): Promise<SplitCommitResult> {
  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildSplitCommitPlan(state.repoPath, options.sha, options.parts)
  const warnings = [...publicHistoryWarnings(state.upstream), ...emptyMessageWarnings(plan.parts)]
  const preview = await previewSplitCommit(state.repoPath, plan, warnings)

  if (!options.apply) return { preview, applied: false }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "split-single-commit")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeSplitCommitRewrite(state.repoPath, plan)
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

export async function getSplitCommitDetails(repoPath: string, sha: string): Promise<SplitCommitDetails> {
  const details = await resolveSplitCommitTarget(repoPath, sha)
  return {
    target: details.target,
    changedPaths: details.changedPaths,
    descendants: details.rangeCommits.slice(1),
  }
}

export async function buildSplitCommitPlan(repoPath: string, sha: string, parts: SplitCommitPart[]): Promise<SplitCommitPlan> {
  if (parts.length < 2) throw new Error("Split requires at least two commit parts")

  const { target, rangeCommits, changedPaths } = await resolveSplitCommitTarget(repoPath, sha)
  validateParts(parts, changedPaths)

  const root = target.parents.length === 0
  const baseCommit = root ? undefined : target.parents[0]
  const todo = rangeCommits.map((commit) => `${commit.sha === target.sha ? "edit" : "pick"} ${commit.sha} ${commit.subject}`).join("\n") + "\n"

  return {
    target,
    baseCommit,
    root,
    descendants: rangeCommits.slice(1),
    parts: parts.map((part) => ({ ...part, paths: [...part.paths] })),
    changedPaths,
    todo,
    changedCommitCount: rangeCommits.length + parts.length - 1,
  }
}

async function resolveSplitCommitTarget(repoPath: string, sha: string): Promise<{ target: CommitSummary; rangeCommits: CommitSummary[]; changedPaths: string[] }> {
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const target = bySha.get(sha)
  if (!target) throw new Error(`Commit ${sha} is not reachable from HEAD`)
  if (target.parents.length > 1) throw new Error(`Merge commit ${target.shortSha} cannot be split in v1`)

  const targetIndex = commits.findIndex((commit) => commit.sha === target.sha)
  const rangeCommits = commits.slice(targetIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  return { target, rangeCommits, changedPaths: await listChangedPaths(repoPath, target.sha) }
}

async function previewSplitCommit(repoPath: string, plan: SplitCommitPlan, warnings: string[]): Promise<SplitCommitPreview> {
  const tmp = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratch = join(tmp, "repo")
  try {
    await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratch] })
    const targetDiff = (await runGitChecked({ repoPath, args: ["show", "--stat", "--patch", "--format=fuller", plan.target.sha] })).stdout
    const rewrite = await executeSplitCommitRewrite(scratch, plan)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
      targetCommit: plan.target,
      changedPaths: plan.changedPaths,
      splitCommitIds: rewrite.splitCommitIds,
      descendants: plan.descendants,
      targetDiff,
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
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function executeSplitCommitRewrite(repoPath: string, plan: SplitCommitPlan): Promise<{ commands: GitCommandResult[]; splitCommitIds: string[] }> {
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-split-"))
  const todoPath = join(helperDir, "todo")
  const editorPath = join(helperDir, "sequence-editor.sh")
  const commands: GitCommandResult[] = []
  const splitCommitIds: string[] = []

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(editorPath, `#!/bin/sh\ncp "${todoPath}" "$1"\n`)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", editorPath]).exited

    const rebaseArgs = plan.root ? ["rebase", "-i", "--root"] : ["rebase", "-i", plan.baseCommit!]
    const rebaseStart = await runGit({ repoPath, args: rebaseArgs, env: { GIT_SEQUENCE_EDITOR: editorPath }, timeoutMs: 120_000 })
    commands.push(rebaseStart)
    if (rebaseStart.exitCode !== 0 && !(await isRebaseInProgress(repoPath))) throw new GitCommandError("Interactive rebase failed to start", rebaseStart)

    const unstage = await resetSelectedCommit(repoPath, plan)
    commands.push(unstage)
    if (unstage.exitCode !== 0) throw new GitCommandError("Reset selected commit failed during split flow", unstage)

    for (const [index, part] of plan.parts.entries()) {
      const add = await runGit({ repoPath, args: ["add", "--", ...part.paths], timeoutMs: 120_000 })
      commands.push(add)
      if (add.exitCode !== 0) throw new GitCommandError("Staging split part failed", add)

      const messagePath = join(helperDir, `part-${index}.message`)
      await Bun.write(messagePath, part.message)
      const commitArgs = ["commit", "-F", messagePath]
      if (part.message === "") commitArgs.push("--allow-empty-message")
      const commit = await runGit({ repoPath, args: commitArgs, timeoutMs: 120_000 })
      commands.push(commit)
      if (commit.exitCode !== 0) throw new GitCommandError("Creating split commit failed", commit)
      splitCommitIds.push((await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim())
    }

    await assertNoRemainingSplitChanges(repoPath)
    await assertTreeMatchesTarget(repoPath, plan.target.sha)

    const cont = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 120_000 })
    commands.push(cont)
    if (cont.exitCode !== 0 && (await hasConflicts(repoPath))) throw new GitCommandError("Rebase stopped with conflicts", cont)
    if (cont.exitCode !== 0 && (await isRebaseInProgress(repoPath))) throw new GitCommandError("Rebase continue failed", cont)

    return { commands, splitCommitIds }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

async function resetSelectedCommit(repoPath: string, plan: SplitCommitPlan): Promise<GitCommandResult> {
  if (plan.root) return runGit({ repoPath, args: ["rm", "-r", "--cached", "--ignore-unmatch", "."], timeoutMs: 120_000 })
  return runGit({ repoPath, args: ["reset", "HEAD^"], timeoutMs: 120_000 })
}

async function assertNoRemainingSplitChanges(repoPath: string): Promise<void> {
  const diff = await runGitChecked({ repoPath, args: ["diff", "--name-only"] })
  const staged = await runGitChecked({ repoPath, args: ["diff", "--cached", "--name-only"] })
  if (diff.stdout.trim() !== "" || staged.stdout.trim() !== "") {
    throw new Error("Split commit left unstaged or staged changes behind")
  }
}

async function assertTreeMatchesTarget(repoPath: string, targetSha: string): Promise<void> {
  const targetTree = (await runGitChecked({ repoPath, args: ["rev-parse", `${targetSha}^{tree}`] })).stdout.trim()
  const splitTree = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD^{tree}"] })).stdout.trim()
  if (splitTree !== targetTree) throw new Error("Split commits do not reproduce the selected commit tree")
}

async function listChangedPaths(repoPath: string, sha: string): Promise<string[]> {
  const result = await runGitChecked({ repoPath, args: ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha] })
  return result.stdout.trim().split("\n").filter(Boolean)
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

function validateParts(parts: SplitCommitPart[], changedPaths: string[]): void {
  const allowed = new Set(changedPaths)
  const seen = new Set<string>()
  for (const [index, part] of parts.entries()) {
    if (part.paths.length === 0) throw new Error(`Split part ${index + 1} must include at least one path`)
    if (part.message === "" && !part.allowEmptyMessage) throw new Error(`Empty message for split part ${index + 1} requires allowEmptyMessage`)
    for (const path of part.paths) {
      if (!allowed.has(path)) throw new Error(`Path ${path} is not changed by the selected commit`)
      if (seen.has(path)) throw new Error(`Path ${path} is assigned to more than one split part`)
      seen.add(path)
    }
  }
  const missing = changedPaths.filter((path) => !seen.has(path))
  if (missing.length > 0) throw new Error(`Every changed path must be assigned to a split part; missing: ${missing.join(", ")}`)
}

function publicHistoryWarnings(upstream?: string): string[] {
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits may require coordinated force-push later.`] : []
}

function emptyMessageWarnings(parts: SplitCommitPart[]): string[] {
  return parts.some((part) => part.message === "") ? ["At least one split commit will have an empty message."] : []
}
