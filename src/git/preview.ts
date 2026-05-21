import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runGitChecked, type GitCommandResult } from "./runner"

export type CommandPlanStep = {
  label: string
  args: string[]
  env?: Record<string, string | undefined>
  stdin?: string
  timeoutMs?: number
}

export type CommandPlan = {
  operationType: string
  baseCommit?: string
  steps: CommandPlanStep[]
}

export type ScratchClone = {
  repoPath: string
  rootPath: string
  dispose: () => Promise<void>
}

export type HistoryPreview = {
  oldHead: string
  newHead: string
  oldGraph: string
  newGraph: string
  diffStat: string
  diffPatch: string
  oldMetadata: string
  newMetadata: string
}

export type RenderedHistoryPreview = {
  summary: string[]
  oldGraph: string[]
  newGraph: string[]
  finalDiffStat: string[]
  finalDiffPatch: string[]
  oldMetadata: string[]
  newMetadata: string[]
}

export async function createScratchClone(repoPath: string): Promise<ScratchClone> {
  const rootPath = await mkdtemp(join(tmpdir(), "gitsurgeon-preview-"))
  const scratchPath = join(rootPath, "repo")
  await runGitChecked({ args: ["clone", "--shared", "--no-hardlinks", repoPath, scratchPath] })

  return {
    repoPath: scratchPath,
    rootPath,
    dispose: () => rm(rootPath, { recursive: true, force: true }),
  }
}

export async function withScratchClone<T>(repoPath: string, callback: (scratch: ScratchClone) => Promise<T>): Promise<T> {
  const scratch = await createScratchClone(repoPath)
  try {
    return await callback(scratch)
  } finally {
    await scratch.dispose()
  }
}

export async function executeCommandPlan(repoPath: string, plan: CommandPlan): Promise<GitCommandResult[]> {
  const results: GitCommandResult[] = []
  for (const step of plan.steps) {
    results.push(await runGitChecked({ repoPath, args: step.args, env: step.env, stdin: step.stdin, timeoutMs: step.timeoutMs }))
  }
  return results
}

export async function buildHistoryPreview(options: {
  repoPath: string
  scratchPath: string
  range: string
  oldHead?: string
  newHead?: string
}): Promise<HistoryPreview> {
  const oldHead = options.oldHead ?? (await runGitChecked({ repoPath: options.repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const newHead = options.newHead ?? (await runGitChecked({ repoPath: options.scratchPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const [oldGraph, newGraph, diffStat, diffPatch, oldMetadata, newMetadata] = await Promise.all([
    graph(options.repoPath, options.range),
    graph(options.scratchPath, options.range),
    runGitChecked({ repoPath: options.scratchPath, args: ["diff", "--stat", oldHead, newHead] }).then((result) => result.stdout),
    runGitChecked({ repoPath: options.scratchPath, args: ["diff", oldHead, newHead] }).then((result) => result.stdout),
    metadata(options.repoPath, options.range),
    metadata(options.scratchPath, options.range),
  ])

  return { oldHead, newHead, oldGraph, newGraph, diffStat, diffPatch, oldMetadata, newMetadata }
}

export function historyRange(baseCommit: string | undefined, root: boolean): string {
  return root ? "HEAD" : `${baseCommit}..HEAD`
}

export function renderHistoryPreview(preview: HistoryPreview, options: { changedCommitCount?: number; droppedCommitIds?: string[] } = {}): RenderedHistoryPreview {
  return {
    summary: [
      `Old HEAD: ${preview.oldHead.slice(0, 12)}`,
      `New HEAD: ${preview.newHead.slice(0, 12)}`,
      `Changed commits: ${options.changedCommitCount ?? "unknown"}`,
      `Dropped commits: ${options.droppedCommitIds?.length ? options.droppedCommitIds.map((sha) => sha.slice(0, 12)).join(", ") : "none"}`,
    ],
    oldGraph: lines(preview.oldGraph),
    newGraph: lines(preview.newGraph),
    finalDiffStat: lines(preview.diffStat),
    finalDiffPatch: lines(preview.diffPatch),
    oldMetadata: lines(preview.oldMetadata),
    newMetadata: lines(preview.newMetadata),
  }
}

async function graph(repoPath: string, range: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["log", "--graph", "--decorate", "--oneline", "--date=short", range] })).stdout
}

async function metadata(repoPath: string, range: string): Promise<string> {
  return (await runGitChecked({
    repoPath,
    args: ["log", "--format=%h%x09%p%x09%aI%x09%cI%x09%an <%ae>%x09%cn <%ce>%x09%s", range],
  })).stdout
}

function lines(value: string): string[] {
  const result = value.split("\n").filter((line) => line.trim() !== "")
  return result.length === 0 ? ["(empty)"] : result
}
