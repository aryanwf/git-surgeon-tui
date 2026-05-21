import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { runGit, runGitChecked } from "./runner"

export type ConflictReport = {
  conflictedFiles: string[]
  rebaseStep?: string
  rebaseTotal?: string
  rebaseHead?: string
}

export async function getConflictReport(repoPath: string): Promise<ConflictReport> {
  const [gitDir, conflictedFiles] = await Promise.all([
    runGitChecked({ repoPath, args: ["rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"] })
      .then((r) => r.stdout.trim().replace(/\/rebase-merge$/, "")),
    getConflictedFiles(repoPath),
  ])

  const rebaseStep = await readGitFile(join(gitDir, "rebase-merge", "msgnum"))
  const rebaseTotal = await readGitFile(join(gitDir, "rebase-merge", "end"))
  const rebaseHead = await readGitFile(join(gitDir, "rebase-merge", "stopped-sha"))

  return {
    conflictedFiles,
    rebaseStep: rebaseStep?.trim(),
    rebaseTotal: rebaseTotal?.trim(),
    rebaseHead: rebaseHead?.trim().slice(0, 12),
  }
}

async function getConflictedFiles(repoPath: string): Promise<string[]> {
  const result = await runGit({ repoPath, args: ["diff", "--name-only", "--diff-filter=U"] })
  if (result.exitCode !== 0) return []
  return result.stdout.trim().split("\n").filter(Boolean)
}

async function readGitFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

export async function rebaseContinue(repoPath: string): Promise<{ exitCode: number; stderr: string }> {
  const result = await runGit({ repoPath, args: ["rebase", "--continue"], env: { GIT_EDITOR: ":" }, timeoutMs: 60_000 })
  return { exitCode: result.exitCode, stderr: result.stderr }
}

export async function rebaseSkip(repoPath: string): Promise<{ exitCode: number; stderr: string }> {
  const result = await runGit({ repoPath, args: ["rebase", "--skip"], timeoutMs: 60_000 })
  return { exitCode: result.exitCode, stderr: result.stderr }
}

export async function rebaseAbort(repoPath: string): Promise<{ exitCode: number; stderr: string }> {
  const result = await runGit({ repoPath, args: ["rebase", "--abort"], timeoutMs: 60_000 })
  return { exitCode: result.exitCode, stderr: result.stderr }
}
