import { expect, test } from "bun:test"
import { join } from "node:path"
import { splitSingleCommit } from "../src/git/split"
import { runGitChecked } from "../src/git/runner"
import { commitSubjects, createFixtureRepo } from "./fixtures"

async function createSplitFixtureRepo(): Promise<{ repoPath: string; commits: string[] }> {
  const fixture = await createFixtureRepo()
  await runGitChecked({ repoPath: fixture.repoPath, args: ["reset", "--hard", fixture.commits[0]] })
  await Bun.write(join(fixture.repoPath, "two.txt"), "two\n")
  await Bun.write(join(fixture.repoPath, "three.txt"), "three\n")
  await runGitChecked({ repoPath: fixture.repoPath, args: ["add", "two.txt", "three.txt"] })
  await runGitChecked({ repoPath: fixture.repoPath, args: ["commit", "-m", "combined commit"] })
  const combined = (await runGitChecked({ repoPath: fixture.repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  await Bun.write(join(fixture.repoPath, "four.txt"), "four\n")
  await runGitChecked({ repoPath: fixture.repoPath, args: ["add", "four.txt"] })
  await runGitChecked({ repoPath: fixture.repoPath, args: ["commit", "-m", "descendant commit"] })
  const descendant = (await runGitChecked({ repoPath: fixture.repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  return { repoPath: fixture.repoPath, commits: [fixture.commits[0], combined, descendant] }
}

test("previews splitting a commit by file in a scratch clone", async () => {
  const { repoPath, commits } = await createSplitFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await splitSingleCommit({
    repoPath,
    sha: commits[1],
    parts: [
      { message: "add second file", paths: ["two.txt"] },
      { message: "add third file", paths: ["three.txt"] },
    ],
  })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(result.preview.changedPaths).toEqual(["three.txt", "two.txt"])
  expect(result.preview.splitCommitIds).toHaveLength(2)
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "combined commit", "descendant commit"])
})

test("applies splitting a commit with backup ref and operation log", async () => {
  const { repoPath, commits } = await createSplitFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const originalTargetDates = await commitDates(repoPath, commits[1])
  const originalDescendantMetadata = await commitMetadata(repoPath, commits[2])

  const result = await splitSingleCommit({
    repoPath,
    sha: commits[1],
    parts: [
      { message: "add second file", paths: ["two.txt"] },
      { message: "add third file", paths: ["three.txt"] },
    ],
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "add second file", "add third file", "descendant commit"])
  const rewrittenCommits = (await runGitChecked({ repoPath, args: ["log", "--reverse", "--format=%H"] })).stdout.trim().split("\n")
  expect(await commitDates(repoPath, rewrittenCommits[1])).toEqual(originalTargetDates)
  expect(await commitDates(repoPath, rewrittenCommits[2])).toEqual(originalTargetDates)
  expect(await commitMetadata(repoPath, rewrittenCommits[3])).toEqual(originalDescendantMetadata)
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("blocks dirty worktrees before splitting a commit", async () => {
  const { repoPath, commits } = await createSplitFixtureRepo()
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  await expect(
    splitSingleCommit({
      repoPath,
      sha: commits[1],
      parts: [
        { message: "add second file", paths: ["two.txt"] },
        { message: "add third file", paths: ["three.txt"] },
      ],
      apply: true,
    }),
  ).rejects.toThrow("dirty")
})

async function commitDates(repoPath: string, sha: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", "--format=%aI%x00%cI", sha] })).stdout.trim()
}

async function commitMetadata(repoPath: string, sha: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B", sha] })).stdout.trim()
}
