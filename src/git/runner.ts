export type GitCommand = {
  args: string[]
  cwd?: string
  repoPath?: string
  env?: Record<string, string | undefined>
  stdin?: string
  timeoutMs?: number
}

export type GitCommandResult = {
  args: string[]
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
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

const decoder = new TextDecoder()

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
  let timeout: Timer | undefined
  if (command.timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true
      proc.kill("SIGTERM")
    }, command.timeoutMs)
  }

  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ])

  if (timeout) clearTimeout(timeout)

  return {
    args,
    cwd,
    stdout: decoder.decode(stdoutBytes),
    stderr: decoder.decode(stderrBytes),
    exitCode,
    durationMs: Math.round(performance.now() - startedAt),
    timedOut,
  }
}

export async function runGitChecked(command: GitCommand): Promise<GitCommandResult> {
  const result = await runGit(command)
  if (result.exitCode !== 0) {
    throw new GitCommandError(`git ${result.args.join(" ")} failed with exit code ${result.exitCode}`, result)
  }
  return result
}
