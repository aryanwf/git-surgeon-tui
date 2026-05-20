import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { runGit, runGitChecked } from "./runner"

export type RepositoryState = {
  repoPath: string
  gitDir: string
  gitCommonDir: string
  branch: string
  head: string
  statusPorcelain: string
  upstream?: string
  rebaseInProgress: boolean
  mergeInProgress: boolean
  cherryPickInProgress: boolean
  revertInProgress: boolean
}

export async function validateRepository(repoPath: string): Promise<RepositoryState> {
  const root = (await runGitChecked({ repoPath, args: ["rev-parse", "--show-toplevel"] })).stdout.trim()
  const gitDirRaw = (await runGitChecked({ repoPath: root, args: ["rev-parse", "--git-dir"] })).stdout.trim()
  const gitCommonDirRaw = (await runGitChecked({ repoPath: root, args: ["rev-parse", "--git-common-dir"] })).stdout.trim()
  const branch = (await runGitChecked({ repoPath: root, args: ["symbolic-ref", "--quiet", "--short", "HEAD"] })).stdout.trim()
  const head = (await runGitChecked({ repoPath: root, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const statusPorcelain = (await runGitChecked({ repoPath: root, args: ["status", "--porcelain=v1"] })).stdout
  const upstreamResult = await runGit({ repoPath: root, args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"] })
  const gitDir = resolveGitPath(root, gitDirRaw)
  const gitCommonDir = resolveGitPath(root, gitCommonDirRaw)

  return {
    repoPath: root,
    gitDir,
    gitCommonDir,
    branch,
    head,
    statusPorcelain,
    upstream: upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : undefined,
    rebaseInProgress: existsSync(resolve(gitDir, "rebase-merge")) || existsSync(resolve(gitDir, "rebase-apply")),
    mergeInProgress: existsSync(resolve(gitDir, "MERGE_HEAD")),
    cherryPickInProgress: existsSync(resolve(gitDir, "CHERRY_PICK_HEAD")),
    revertInProgress: existsSync(resolve(gitDir, "REVERT_HEAD")),
  }
}

export function assertRewriteReady(state: RepositoryState): void {
  if (state.rebaseInProgress || state.mergeInProgress || state.cherryPickInProgress || state.revertInProgress) {
    throw new Error("A rebase, merge, cherry-pick, or revert is already in progress")
  }
  if (state.statusPorcelain.trim() !== "") {
    throw new Error("Rewrite blocked because the worktree or index is dirty")
  }
}

function resolveGitPath(repoPath: string, gitPath: string): string {
  return gitPath.startsWith("/") ? gitPath : resolve(repoPath, gitPath)
}
