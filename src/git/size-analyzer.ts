import { existsSync } from "node:fs"
import { join } from "node:path"
import { validateRepository } from "./repository"
import { runGitChecked } from "./runner"

export type SizeAnalyzerMethod = "native" | "filter-repo"
export type SizeAnalyzerSort = "unpacked" | "packed"
export type SizeAnalyzerStatus = "all" | "present" | "deleted"

export type SizeAnalyzerOptions = {
  repoPath: string
  method?: SizeAnalyzerMethod
  sortBy?: SizeAnalyzerSort
  status?: SizeAnalyzerStatus
  limit?: number
}

export type SizeAnalyzerRow = {
  objectId: string
  unpackedSize: number
  packedSize: number
  status: "present" | "deleted"
  paths: string[]
}

export type SizeAnalyzerResult = {
  repoPath: string
  method: SizeAnalyzerMethod
  sortBy: SizeAnalyzerSort
  status: SizeAnalyzerStatus
  rows: SizeAnalyzerRow[]
}

type MutableSizeRow = Omit<SizeAnalyzerRow, "paths"> & { paths: Set<string> }

export async function analyzeRepositorySize(options: SizeAnalyzerOptions): Promise<SizeAnalyzerResult> {
  const state = await validateRepository(options.repoPath)
  const method = options.method ?? "native"
  const sortBy = options.sortBy ?? "unpacked"
  const status = options.status ?? "all"
  const rows = method === "filter-repo"
    ? await analyzeWithFilterRepo(state.repoPath, state.gitCommonDir)
    : await analyzeWithNativeGit(state.repoPath)

  const filteredRows = rows
    .filter((row) => status === "all" || row.status === status)
    .sort((left, right) => {
      const sizeDelta = sortBy === "packed"
        ? right.packedSize - left.packedSize
        : right.unpackedSize - left.unpackedSize
      return sizeDelta || left.paths.join("\0").localeCompare(right.paths.join("\0"))
    })

  return {
    repoPath: state.repoPath,
    method,
    sortBy,
    status,
    rows: options.limit === undefined ? filteredRows : filteredRows.slice(0, options.limit),
  }
}

async function analyzeWithNativeGit(repoPath: string): Promise<SizeAnalyzerRow[]> {
  const currentPaths = await currentHeadPaths(repoPath)
  const revList = await runGitChecked({ repoPath, args: ["rev-list", "--objects", "--all", "--missing=print"] })
  const objectInput = revList.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !line.startsWith("?"))
    .join("\n")

  if (objectInput === "") return []

  const catFile = await runGitChecked({
    repoPath,
    args: ["cat-file", "--batch-check=%(objecttype) %(objectname) %(objectsize) %(objectsize:disk) %(rest)"],
    stdin: `${objectInput}\n`,
  })

  const rowsByObject = new Map<string, MutableSizeRow>()
  for (const line of catFile.stdout.split("\n")) {
    if (!line.startsWith("blob ")) continue
    const parsed = parseNativeBlobLine(line)
    if (!parsed) continue

    const existing = rowsByObject.get(parsed.objectId)
    if (existing) {
      if (parsed.path) existing.paths.add(parsed.path)
      continue
    }

    rowsByObject.set(parsed.objectId, {
      objectId: parsed.objectId,
      unpackedSize: parsed.unpackedSize,
      packedSize: parsed.packedSize,
      status: parsed.path && currentPaths.has(parsed.path) ? "present" : "deleted",
      paths: new Set(parsed.path ? [parsed.path] : []),
    })
  }

  return Array.from(rowsByObject.values()).map((row) => {
    const paths = Array.from(row.paths).sort()
    return {
      objectId: row.objectId,
      unpackedSize: row.unpackedSize,
      packedSize: row.packedSize,
      status: paths.some((path) => currentPaths.has(path)) ? "present" : "deleted",
      paths,
    }
  })
}

async function analyzeWithFilterRepo(repoPath: string, gitCommonDir: string): Promise<SizeAnalyzerRow[]> {
  await runGitChecked({ repoPath, args: ["filter-repo", "--analyze"] })
  const reportPath = join(gitCommonDir, "filter-repo", "analysis", "path-all-sizes.txt")
  if (!existsSync(reportPath)) throw new Error("git-filter-repo did not produce path-all-sizes.txt")

  const currentPaths = await currentHeadPaths(repoPath)
  const report = await Bun.file(reportPath).text()
  return report
    .split("\n")
    .map((line) => parseFilterRepoPathLine(line, currentPaths))
    .filter((row): row is SizeAnalyzerRow => row !== undefined)
}

async function currentHeadPaths(repoPath: string): Promise<Set<string>> {
  const result = await runGitChecked({ repoPath, args: ["ls-tree", "-r", "-z", "--name-only", "HEAD"] })
  return new Set(result.stdout.split("\0").filter(Boolean))
}

function parseNativeBlobLine(line: string): { objectId: string; unpackedSize: number; packedSize: number; path?: string } | undefined {
  const parts = line.split(" ")
  if (parts.length < 4) return undefined
  const [, objectId, unpackedRaw, packedRaw] = parts
  const path = parts.slice(4).join(" ") || undefined
  return {
    objectId,
    unpackedSize: parseGitSize(unpackedRaw),
    packedSize: parseGitSize(packedRaw),
    path,
  }
}

function parseFilterRepoPathLine(line: string, currentPaths: Set<string>): SizeAnalyzerRow | undefined {
  const trimmed = line.trim()
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("==") || trimmed.startsWith("Format:")) return undefined
  const match = trimmed.match(/^(\d+)\s+(\d+)\s+(?:<present>|\S+)\s+(.+)$/)
  if (!match) return undefined
  const path = match[3]
  return {
    objectId: "",
    unpackedSize: Number(match[1]),
    packedSize: Number(match[2]),
    status: currentPaths.has(path) ? "present" : "deleted",
    paths: [path],
  }
}

function parseGitSize(value: string): number {
  const size = Number(value)
  return Number.isFinite(size) ? size : 0
}
