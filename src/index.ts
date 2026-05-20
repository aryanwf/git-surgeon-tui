import { renameOldCommitMessages, type RenameCommitMessage } from "./git/reword"
import { dropSingleCommit } from "./git/drop"

type CliOptions = {
  repo?: string
  messages: RenameCommitMessage[]
  sha?: string
  apply: boolean
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args
  if (command !== "rename" && command !== "drop") {
    printUsage()
    process.exit(command ? 1 : 0)
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
  if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`)
  if (result.operationLogPath) console.log(`Operation log: ${result.operationLogPath}`)
  for (const warning of result.preview.warnings) console.warn(`Warning: ${warning}`)
}

function parseDropArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], apply: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--repo") options.repo = args[++index]
    else if (arg === "--apply") options.apply = true
    else if (arg === "--sha") options.sha = args[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function parseRenameArgs(args: string[]): CliOptions {
  const options: CliOptions = { messages: [], apply: false }
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

function parseMessageArg(value: string | undefined): RenameCommitMessage {
  if (!value) throw new Error("Missing --message value")
  const separator = value.indexOf("=")
  if (separator <= 0) throw new Error("Message must use <sha=message>")
  return { sha: value.slice(0, separator), message: value.slice(separator + 1) }
}

function printUsage(): void {
  console.log("Usage: bun src/index.ts rename --repo <path> --message <sha=message> [--message <sha=message>] [--apply]")
  console.log("       bun src/index.ts drop --repo <path> --sha <commit> [--apply]")
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { renameOldCommitMessages } from "./git/reword"
export { dropSingleCommit } from "./git/drop"
