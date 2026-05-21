import { renameOldCommitMessages, type RenameCommitMessage } from "./git/reword"
import { dropSingleCommit } from "./git/drop"
import { splitSingleCommit, type SplitCommitPart } from "./git/split"
import { visualInteractiveRebase, type VisualRebaseRow } from "./git/rebase"
import { changeOldCommitDate, type DateChangeMode } from "./git/date"
import { analyzeRepositorySize, type SizeAnalyzerMethod, type SizeAnalyzerSort, type SizeAnalyzerStatus } from "./git/size-analyzer"

type CliOptions = {
  repo?: string
  messages: RenameCommitMessage[]
  parts: SplitCommitPart[]
  rows: VisualRebaseRow[]
  sha?: string
  base?: string
  date?: string
  mode?: DateChangeMode
  method?: SizeAnalyzerMethod
  sortBy?: SizeAnalyzerSort
  status?: SizeAnalyzerStatus
  limit?: number
  apply: boolean
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args
  if (command !== "rename" && command !== "drop" && command !== "split" && command !== "rebase" && command !== "date" && command !== "size") {
    printUsage()
    process.exit(command ? 1 : 0)
  }

  if (command === "size") {
    const options = parseSizeArgs(rest)
    if (!options.repo) throw new Error("Missing --repo <path>")
    const result = await analyzeRepositorySize({ repoPath: options.repo, method: options.method, sortBy: options.sortBy, status: options.status, limit: options.limit })

    console.log(`Analyzed repository size with ${result.method}`)
    console.log(`Sorted by: ${result.sortBy}`)
    console.log("Unpacked\tPacked\tStatus\tObject ID\tPath(s)")
    for (const row of result.rows) {
      console.log(`${formatSize(row.unpackedSize)}\t${formatSize(row.packedSize)}\t${row.status}\t${row.objectId || "-"}\t${row.paths.join(", ")}`)
    }
    return
  }

  if (command === "date") {
    const options = parseDateArgs(rest)
    if (!options.repo) throw new Error("Missing --repo <path>")
    if (!options.sha) throw new Error("Missing --sha <commit>")
    if (!options.date) throw new Error("Missing --date <iso-8601>")
    if (!options.mode) throw new Error("Missing --mode <author|committer|both>")
    const result = await changeOldCommitDate({ repoPath: options.repo, sha: options.sha, date: options.date, mode: options.mode, apply: options.apply })

    console.log(options.apply ? "Applied date rewrite" : "Previewed date rewrite")
    console.log(`Old HEAD: ${result.preview.oldHead}`)
    console.log(`New HEAD: ${result.preview.newHead}`)
    console.log(`Changed commits: ${result.preview.changedCommitCount}`)
    printHistoryPreview(result.preview)
    console.log("New verification log:")
    console.log(result.preview.newLog.trimEnd())
    if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
    if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
    for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
    return
  }

  if (command === "rebase") {
    const options = parseRebaseArgs(rest)
    if (!options.repo) throw new Error("Missing --repo <path>")
    if (!options.base) throw new Error("Missing --base <commit>")
    const result = await visualInteractiveRebase({ repoPath: options.repo, base: options.base, rows: options.rows, apply: options.apply })

    console.log(options.apply ? "Applied visual rebase" : "Previewed visual rebase")
    console.log(`Old HEAD: ${result.preview.oldHead}`)
    console.log(`New HEAD: ${result.preview.newHead}`)
    console.log(`Changed commits: ${result.preview.changedCommitCount}`)
    printHistoryPreview(result.preview)
    console.log("Generated todo:")
    console.log(result.preview.todo.trimEnd())
    if (result.preview.droppedCommitIds.length > 0) console.log(`Dropped commits: ${result.preview.droppedCommitIds.join(", ")}`)
    if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
    if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
    for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
    return
  }

  if (command === "split") {
    const options = parseSplitArgs(rest)
    if (!options.repo) throw new Error("Missing --repo <path>")
    if (!options.sha) throw new Error("Missing --sha <commit>")
    const result = await splitSingleCommit({ repoPath: options.repo, sha: options.sha, parts: options.parts, apply: options.apply })

    console.log(options.apply ? "Applied split rewrite" : "Previewed split rewrite")
    console.log(`Old HEAD: ${result.preview.oldHead}`)
    console.log(`New HEAD: ${result.preview.newHead}`)
    console.log(`Changed commits: ${result.preview.changedCommitCount}`)
    printHistoryPreview(result.preview)
    console.log(`Split commits: ${result.preview.splitCommitIds.join(", ")}`)
    if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
    if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
    for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
    return
  }

  if (command === "drop") {
    const options = parseDropArgs(rest)
    if (!options.repo) throw new Error("Missing --repo <path>")
    if (!options.sha) throw new Error("Missing --sha <commit>")
    const result = await dropSingleCommit({ repoPath: options.repo, sha: options.sha, apply: options.apply })

    console.log(options.apply ? "Applied drop rewrite" : "Previewed drop rewrite")
    console.log(`Old HEAD: ${result.preview.oldHead}`)
    console.log(`New HEAD: ${result.preview.newHead}`)
    console.log(`Changed commits: ${result.preview.changedCommitCount}`)
    printHistoryPreview(result.preview)
    console.log(`Dropped commit: ${result.preview.droppedCommitIds[0]}`)
    if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
    if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
    for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
    return
  }

  const options = parseRenameArgs(rest)
  if (!options.repo) throw new Error("Missing --repo <path>")
  const result = await renameOldCommitMessages({ repoPath: options.repo, messages: options.messages, apply: options.apply })

  console.log(options.apply ? "Applied rename rewrite" : "Previewed rename rewrite")
  console.log(`Old HEAD: ${result.preview.oldHead}`)
  console.log(`New HEAD: ${result.preview.newHead}`)
  console.log(`Changed commits: ${result.preview.changedCommitCount}`)
  printHistoryPreview(result.preview)
  if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
  if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
  for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
}

function printHistoryPreview(preview: {
  oldGraph: string
  newGraph: string
  oldMetadata: string
  newMetadata: string
  finalDiffStat: string
  finalDiffPatch: string
}): void {
  console.log("Before graph:")
  console.log(preview.oldGraph.trimEnd() || "(empty)")
  console.log("After graph:")
  console.log(preview.newGraph.trimEnd() || "(empty)")
  console.log("Before metadata:")
  console.log(preview.oldMetadata.trimEnd() || "(empty)")
  console.log("After metadata:")
  console.log(preview.newMetadata.trimEnd() || "(empty)")
  console.log("Final diff stat:")
  console.log(preview.finalDiffStat.trimEnd() || "(no tree changes)")
  console.log("Final diff:")
  console.log(preview.finalDiffPatch.trimEnd() || "(no tree changes)")
}

function parseDropArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--sha") options.sha = args[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function parseSplitArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--sha") options.sha = args[++index]
    else if (arg === "--part") options.parts.push(parsePartArg(args[++index]))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.parts.length < 2) throw new Error("Pass at least two --part <message:path,path> values")
  return options
}

function parseRenameArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--message") options.messages.push(parseMessageArg(args[++index]))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.messages.length === 0) throw new Error("Pass at least one --message <sha=message>")
  return options
}

function parseRebaseArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--base") options.base = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--row") options.rows.push(parseRowArg(args[++index]))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.rows.length === 0) throw new Error("Pass at least one --row <action:sha[:message-or-command]> value")
  return options
}

function parseDateArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--sha") options.sha = args[++index]
    else if (arg === "--date") options.date = args[++index]
    else if (arg === "--mode") options.mode = parseDateMode(args[++index])
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function parseSizeArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], parts: [], rows: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--method") options.method = parseSizeMethod(args[++index])
    else if (arg === "--sort") options.sortBy = parseSizeSort(args[++index])
    else if (arg === "--status") options.status = parseSizeStatus(args[++index])
    else if (arg === "--limit") options.limit = parseLimit(args[++index])
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function parseMessageArg(value: string | undefined): RenameCommitMessage {
  if (!value) throw new Error("Missing --message value")
  const separator = value.indexOf("=")
  if (separator <= 0) throw new Error("Message must use <sha=message>")
  return { sha: value.slice(0, separator), message: value.slice(separator + 1) }
}

function parsePartArg(value: string | undefined): SplitCommitPart {
  if (!value) throw new Error("Missing --part value")
  const separator = value.indexOf(":")
  if (separator <= 0) throw new Error("Part must use <message:path,path>")
  const paths = value.slice(separator + 1).split(",").map((path) => path.trim()).filter(Boolean)
  if (paths.length === 0) throw new Error("Part must include at least one path")
  return { message: value.slice(0, separator), paths }
}

function parseRowArg(value: string | undefined): VisualRebaseRow {
  if (!value) throw new Error("Missing --row value")
  const [action, sha, ...rest] = value.split(":")
  if (!action || !sha) throw new Error("Row must use <action:sha[:message-or-command]>")
  if (!isVisualRebaseAction(action)) throw new Error(`Unsupported rebase action: ${action}`)
  const payload = rest.join(":")
  if (action === "exec") return { action, sha, command: payload }
  if (action === "reword" || action === "squash") return { action, sha, message: payload }
  if (payload !== "") throw new Error(`Action ${action} does not accept a payload`)
  return { action, sha }
}

function isVisualRebaseAction(value: string): value is VisualRebaseRow["action"] {
  return value === "pick" || value === "reword" || value === "edit" || value === "squash" || value === "fixup" || value === "drop" || value === "exec"
}

function parseDateMode(value: string | undefined): DateChangeMode {
  if (value === "author" || value === "committer" || value === "both") return value
  throw new Error("Date mode must be author, committer, or both")
}

function parseSizeMethod(value: string | undefined): SizeAnalyzerMethod {
  if (value === "native" || value === "filter-repo") return value
  throw new Error("Size analyzer method must be native or filter-repo")
}

function parseSizeSort(value: string | undefined): SizeAnalyzerSort {
  if (value === "unpacked" || value === "packed") return value
  throw new Error("Size analyzer sort must be unpacked or packed")
}

function parseSizeStatus(value: string | undefined): SizeAnalyzerStatus {
  if (value === "all" || value === "present" || value === "deleted") return value
  throw new Error("Size analyzer status must be all, present, or deleted")
}

function parseLimit(value: string | undefined): number {
  const limit = Number(value)
  if (Number.isInteger(limit) && limit > 0) return limit
  throw new Error("Limit must be a positive integer")
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function printUsage(): void {
  console.log("Usage: bun src/index.ts rename --repo <path> --message <sha=message> [--message <sha=message>] [--apply]")
  console.log("       bun src/index.ts drop --repo <path> --sha <commit> [--apply]")
  console.log("       bun src/index.ts split --repo <path> --sha <commit> --part <message:path,path> --part <message:path> [--apply]")
  console.log("       bun src/index.ts rebase --repo <path> --base <commit> --row <action:sha[:message-or-command]> [--row ...] [--apply]")
  console.log("       bun src/index.ts date --repo <path> --sha <commit> --date <iso-8601> --mode <author|committer|both> [--apply]")
  console.log("       bun src/index.ts size --repo <path> [--method <native|filter-repo>] [--sort <unpacked|packed>] [--status <all|present|deleted>] [--limit <n>]")
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { renameOldCommitMessages } from "./git/reword"
export { dropSingleCommit } from "./git/drop"
export { splitSingleCommit } from "./git/split"
export { visualInteractiveRebase } from "./git/rebase"
export { changeOldCommitDate } from "./git/date"
export { analyzeRepositorySize } from "./git/size-analyzer"
export { buildHistoryPreview, historyRange, type HistoryPreview } from "./git/preview"
