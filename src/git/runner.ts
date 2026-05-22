export type GitCommand = {
  args: string[]
  cwd?: string
  repoPath?: string
  env?: Record<string, string | undefined>
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export type GitCommandResult = {
  args: string[]
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
  cancelled: boolean
}

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly result: GitCommandResult,
  ) {
    super(message)
    this.name = "GitCommandError"
  }
}

export async function runGit(command: GitCommand): Promise<GitCommandResult> {
  const startedAt = performance.now()
  const cwd = command.cwd ?? process.cwd()
  const args = command.repoPath ? ["-C", command.repoPath, ...command.args] : command.args
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, ...command.env },
    stdin: command.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (command.stdin !== undefined && proc.stdin) {
    proc.stdin.write(command.stdin)
    proc.stdin.end()
  }

  let timedOut = false
  let cancelled = command.signal?.aborted ?? false
  let timeout: Timer | undefined
  let terminateTimeout: Timer | undefined
  const terminate = (reason: "timeout" | "cancelled") => {
    if (reason === "timeout") timedOut = true
    if (reason === "cancelled") cancelled = true
    proc.kill("SIGINT")
    terminateTimeout = setTimeout(() => proc.kill("SIGTERM"), 1_000)
  }

  if (command.timeoutMs !== undefined) {
    timeout = setTimeout(() => terminate("timeout"), command.timeoutMs)
  }

  const abort = () => terminate("cancelled")
  if (command.signal) {
    if (command.signal.aborted) abort()
    else command.signal.addEventListener("abort", abort, { once: true })
  }

  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    readStream(proc.stdout, command.onStdout),
    readStream(proc.stderr, command.onStderr),
    proc.exited,
  ])

  if (timeout) clearTimeout(timeout)
  if (terminateTimeout) clearTimeout(terminateTimeout)
  if (command.signal) command.signal.removeEventListener("abort", abort)

  return {
    args,
    cwd,
    stdout: stdoutBytes,
    stderr: stderrBytes,
    exitCode,
    durationMs: Math.round(performance.now() - startedAt),
    timedOut,
    cancelled,
  }
}

export async function runGitChecked(command: GitCommand): Promise<GitCommandResult> {
  const result = await runGit(command)
  if (result.exitCode !== 0) {
    throw new GitCommandError(`git ${result.args.join(" ")} failed`, result)
  }
  return result
}

async function readStream(stream: ReadableStream<Uint8Array>, onChunk?: (chunk: string) => void): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    output += chunk
    onChunk?.(chunk)
  }

  const trailing = decoder.decode()
  if (trailing) {
    output += trailing
    onChunk?.(trailing)
  }

  return output
}
