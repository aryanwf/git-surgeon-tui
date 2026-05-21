import { mkdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { OperationLog } from "./safety"
import { validateRepository } from "./repository"

export type ExportOperationReportOptions = {
  repoPath: string
  outputPath?: string
}

export type ExportOperationReportResult = {
  sourceLogPath: string
  outputPath: string
  report: string
}

export async function exportLatestOperationReport(options: ExportOperationReportOptions): Promise<ExportOperationReportResult> {
  const repository = await validateRepository(options.repoPath)
  const sourceLogPath = await latestOperationLogPath(repository.gitCommonDir)
  const log = JSON.parse(await readFile(sourceLogPath, "utf8")) as OperationLog
  const report = formatOperationReport(log)
  const outputPath = options.outputPath ?? join(repository.gitCommonDir, "gitsurgeon", "reports", `${basename(sourceLogPath, ".json")}.md`)
  await mkdir(dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, report)
  return { sourceLogPath, outputPath, report }
}

export function formatOperationReport(log: OperationLog): string {
  const lines = [
    "# Git Surgeon Operation Report",
    "",
    `- Repository: ${log.repoPath}`,
    `- Branch: ${log.branch}`,
    `- Operation: ${log.operationType}`,
    `- Status: ${log.status}`,
    `- Started: ${log.startedAt}`,
    `- Finished: ${log.finishedAt ?? "(not recorded)"}`,
    `- Git: ${log.gitVersion}`,
    `- Old HEAD: ${log.oldHead}`,
    `- New HEAD: ${log.newHead ?? "(not recorded)"}`,
    `- Backup ref: ${log.backupRef ?? "(none)"}`,
  ]

  if (log.baseCommit) lines.push(`- Base commit: ${log.baseCommit}`)
  lines.push("", "## Commands", "")
  lines.push(...(log.commands.length > 0 ? log.commands.map((command) => `- \`${command}\``) : ["- (none recorded)"]))
  lines.push("", "## Errors", "")
  lines.push(...(log.errors.length > 0 ? log.errors.map((error) => `- ${error}`) : ["- (none)"]))
  return `${lines.join("\n")}\n`
}

async function latestOperationLogPath(gitCommonDir: string): Promise<string> {
  const operationsDir = join(gitCommonDir, "gitsurgeon", "operations")
  const glob = new Bun.Glob("*.json")
  const entries: string[] = []
  for await (const entry of glob.scan({ cwd: operationsDir, onlyFiles: true })) entries.push(entry)
  entries.sort()
  const latest = entries.at(-1)
  if (!latest) throw new Error("No Git Surgeon operation logs found")
  return join(operationsDir, latest)
}
