import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { runGitChecked, type GitCommandResult } from "./runner"
import type { RepositoryState } from "./repository"

export type OperationLog = {
  repoPath: string
  branch: string
  backupRef?: string
  startedAt: string
  finishedAt?: string
  gitVersion: string
  operationType: string
  baseCommit?: string
  oldHead: string
  newHead?: string
  commands: string[]
  status: "started" | "previewed" | "applied" | "failed"
  errors: string[]
}

export function timestampForRef(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

export async function createBackupRef(state: RepositoryState, timestamp = timestampForRef()): Promise<string> {
  const safeBranch = state.branch.replaceAll("/", "-")
  const backupRef = `refs/gitsurgeon/backups/${timestamp}/${safeBranch}`
  await runGitChecked({ repoPath: state.repoPath, args: ["update-ref", backupRef, "HEAD"] })
  return backupRef
}

export async function buildOperationLog(state: RepositoryState, operationType: string): Promise<OperationLog> {
  const gitVersion = (await runGitChecked({ repoPath: state.repoPath, args: ["--version"] })).stdout.trim()
  return {
    repoPath: state.repoPath,
    branch: state.branch,
    startedAt: new Date().toISOString(),
    gitVersion,
    operationType,
    oldHead: state.head,
    commands: [],
    status: "started",
    errors: [],
  }
}

export async function writeOperationLog(state: RepositoryState, timestamp: string, log: OperationLog): Promise<string> {
  const operationsDir = join(state.gitCommonDir, "gitsurgeon", "operations")
  await mkdir(operationsDir, { recursive: true })
  const path = join(operationsDir, `${timestamp}.json`)
  await Bun.write(path, `${JSON.stringify(log, null, 2)}\n`)
  return path
}

export function commandLine(result: Pick<GitCommandResult, "args">): string {
  return `git ${result.args.join(" ")}`
}
