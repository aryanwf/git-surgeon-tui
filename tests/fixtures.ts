import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runGitChecked } from "../src/git/runner"

export async function createFixtureRepo(): Promise<{ repoPath: string; commits: string[] }> {
  const repoPath = await mkdtemp(join(tmpdir(), "gitsurgeon-test-"))
  await runGitChecked({ repoPath, args: ["init", "-b", "main"] })
  await runGitChecked({ repoPath, args: ["config", "user.name", "Test User"] })
  await runGitChecked({ repoPath, args: ["config", "user.email", "test@example.com"] })

  const commits: string[] = []
  for (const [file, content, message] of [
    ["one.txt", "one", "first commit"],
    ["two.txt", "two", "second commit"],
    ["three.txt", "three", "third commit"],
  ] as const) {
    await Bun.write(join(repoPath, file), `${content}\n`)
    await runGitChecked({ repoPath, args: ["add", file] })
    await runGitChecked({ repoPath, args: ["commit", "-m", message] })
    commits.push((await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim())
  }

  return { repoPath, commits }
}

export async function commitSubjects(repoPath: string): Promise<string[]> {
  const result = await runGitChecked({ repoPath, args: ["log", "--reverse", "--format=%s"] })
  return result.stdout.trim().split("\n")
}
