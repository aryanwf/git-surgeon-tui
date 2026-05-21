import { runGitChecked } from "./runner"

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

async function graph(repoPath: string, range: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["log", "--graph", "--decorate", "--oneline", "--date=short", range] })).stdout
}

async function metadata(repoPath: string, range: string): Promise<string> {
  return (await runGitChecked({
    repoPath,
    args: ["log", "--format=%h%x09%p%x09%aI%x09%cI%x09%an <%ae>%x09%cn <%ce>%x09%s", range],
  })).stdout
}
