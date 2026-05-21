import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHeadCommits, type CommitSummary } from "./log"
import { assertRewriteReady, validateRepository } from "./repository"
import { GitCommandError, runGit, runGitChecked, type GitCommandResult } from "./runner"
import { buildOperationLog, commandLine, createBackupRef, timestampForRef, writeOperationLog } from "./safety"
import { buildHistoryPreview, historyRange, type HistoryPreview } from "./preview"

export type DropCommitPreview = {
  oldHead: string
  newHead: string
  backupRef?: string
  baseCommit?: string
  droppedCommitIds: string[]
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

export type DropCommitResult = {
  preview: DropCommitPreview
  applied: boolean
  backupRef?: string
  operationLogPath?: string
}

type DropCommitPlan = {
  target: CommitSummary
  baseCommit?: string
  root: boolean
  descendants: CommitSummary[]
  todo: string
  changedCommitCount: number
}

export async function dropSingleCommit(options: { repoPath: string; sha: string; apply?: boolean }): Promise<DropCommitResult> {
  const state = await validateRepository(options.repoPath)
  assertRewriteReady(state)
  const plan = await buildDropCommitPlan(state.repoPath, options.sha)
  const warnings = publicHistoryWarnings(state.upstream)
  const preview = await previewDropCommit(state.repoPath, plan, warnings)

  if (!options.apply) return { preview, applied: false }

  const timestamp = timestampForRef()
  const backupRef = await createBackupRef(state, timestamp)
  const log = await buildOperationLog(state, "drop-single-commit")
  log.backupRef = backupRef
  log.baseCommit = plan.baseCommit

  try {
    const applyResult = await executeDropCommitRewrite(state.repoPath, plan)
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

export async function buildDropCommitPlan(repoPath: string, sha: string): Promise<DropCommitPlan> {
  const commits = await getHeadCommits(repoPath)
  const bySha = new Map(commits.flatMap((commit) => [[commit.sha, commit], [commit.shortSha, commit]] as const))
  const target = bySha.get(sha)
  if (!target) throw new Error(`Commit ${sha} is not reachable from HEAD`)
  if (target.parents.length > 1) throw new Error(`Merge commit ${target.shortSha} cannot be dropped in v1`)

  const targetIndex = commits.findIndex((commit) => commit.sha === target.sha)
  const rangeCommits = commits.slice(targetIndex)
  const mergeInRange = rangeCommits.find((commit) => commit.parents.length > 1)
  if (mergeInRange) throw new Error(`Selected range contains merge commit ${mergeInRange.shortSha}; --rebase-merges is not enabled in v1`)

  const root = target.parents.length === 0
  const baseCommit = root ? undefined : target.parents[0]
  const todo = rangeCommits.map((commit) => `${commit.sha === target.sha ? "drop" : "pick"} ${commit.sha} ${commit.subject}`).join("\n") + "\n"

  return {
    target,
    baseCommit,
    root,
    descendants: rangeCommits.slice(1),
    todo,
    changedCommitCount: rangeCommits.length,
  }
}

async function previewDropCommit(repoPath: string, plan: DropCommitPlan, warnings: string[]): Promise<DropCommitPreview> {
  const tmp = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratch = join(tmp, "repo")
  try {
    await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratch] })
    const targetDiff = (await runGitChecked({ repoPath, args: ["show", "--stat", "--patch", "--format=fuller", plan.target.sha] })).stdout
    await executeDropCommitRewrite(scratch, plan)
    const historyPreview = await buildHistoryPreview({ repoPath, scratchPath: scratch, range: historyRange(plan.baseCommit, plan.root) })
    return {
      oldHead: historyPreview.oldHead,
      newHead: historyPreview.newHead,
      baseCommit: plan.baseCommit,
      droppedCommitIds: [plan.target.sha],
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

async function executeDropCommitRewrite(repoPath: string, plan: DropCommitPlan): Promise<{ commands: GitCommandResult[] }> {
  const helperDir = await mkdtemp(join(tmpdir(), "gitsurgeon-drop-"))
  const todoPath = join(helperDir, "todo")
  const editorPath = join(helperDir, "sequence-editor.sh")
  const commands: GitCommandResult[] = []

  try {
    await Bun.write(todoPath, plan.todo)
    await Bun.write(editorPath, `#!/bin/sh\ncp "${todoPath}" "$1"\n`)
    await runGitChecked({ args: ["update-index", "--refresh"], repoPath })
    await Bun.spawn(["chmod", "+x", editorPath]).exited

    const rebaseArgs = plan.root ? ["rebase", "-i", "--root"] : ["rebase", "-i", plan.baseCommit!]
    const rebase = await runGit({ repoPath, args: rebaseArgs, env: { GIT_SEQUENCE_EDITOR: editorPath, GIT_EDITOR: ":" }, timeoutMs: 120_000 })
    commands.push(rebase)
    if (rebase.exitCode !== 0 && (await hasConflicts(repoPath))) throw new GitCommandError("Rebase stopped with conflicts", rebase)
    if (rebase.exitCode !== 0) throw new GitCommandError("Drop commit rebase failed", rebase)

    return { commands }
  } finally {
    await rm(helperDir, { recursive: true, force: true })
  }
}

async function hasConflicts(repoPath: string): Promise<boolean> {
  const result = await runGitChecked({ repoPath, args: ["diff", "--name-only", "--diff-filter=U"] })
  return result.stdout.trim() !== "" || (await isRebaseInProgress(repoPath))
}

async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const mergePath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"] })).stdout.trim()
  const applyPath = (await runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-apply"] })).stdout.trim()
  return existsSync(mergePath) || existsSync(applyPath)
}

function publicHistoryWarnings(upstream?: string): string[] {
  return upstream ? [`Current branch tracks ${upstream}; rewriting published commits may require coordinated force-push later.`] : []
}
