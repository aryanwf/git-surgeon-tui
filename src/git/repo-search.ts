import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { runGit } from "./runner"

export async function discoverRepoFolders(rootPath: string): Promise<string[]> {
  const repos: string[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }]
  const maxDepth = 6
  const maxRepos = 500

  while (queue.length > 0 && repos.length < maxRepos) {
    const current = queue.shift()!
    let entries: Dirent[]
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    if (entries.some((entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()))) {
      repos.push(current.path)
      continue
    }

    if (current.depth >= maxDepth) continue

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipRepoSearchDir(entry.name)) continue
      queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
    }
  }

  return repos
}

export async function filterValidRepoPaths(paths: string[]): Promise<string[]> {
  const candidates = uniquePaths(paths.map((path) => resolve(path)))
  const roots: string[] = []
  for (const candidate of candidates) {
    const root = await findRepositoryRoot(candidate)
    if (root) roots.push(root)
  }
  return uniquePaths(roots)
}

async function findRepositoryRoot(repoPath: string): Promise<string | undefined> {
  const result = await runGit({ repoPath, args: ["rev-parse", "--show-toplevel"] })
  if (result.exitCode !== 0) return undefined
  return result.stdout.trim() || undefined
}

function shouldSkipRepoSearchDir(name: string): boolean {
  return name.startsWith(".") || ["node_modules", "vendor", "dist", "build", "target", "Library"].includes(name)
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}
