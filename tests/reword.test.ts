import { expect, test } from "bun:test"
import { runGitChecked } from "../src/git/runner"
import { renameOldCommitMessages } from "../src/git/reword"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("previews commit message rename in a scratch clone", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await renameOldCommitMessages({
    repoPath,
    messages: [{ sha: commits[1], message: "renamed second commit" }],
  })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("applies commit message rename with backup ref and operation log", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const oldDates = await commitDates(repoPath)

  const result = await renameOldCommitMessages({
    repoPath,
    messages: [{ sha: commits[1], message: "renamed second commit" }],
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "renamed second commit", "third commit"])
  expect(await commitDates(repoPath)).toEqual(oldDates)
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("renames the root commit with --root rebase", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await renameOldCommitMessages({
    repoPath,
    messages: [{ sha: commits[0], message: "renamed root commit" }],
    apply: true,
  })

  expect(await commitSubjects(repoPath)).toEqual(["renamed root commit", "second commit", "third commit"])
})

test("blocks dirty worktrees", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  await expect(
    renameOldCommitMessages({ repoPath, messages: [{ sha: commits[1], message: "rename" }], apply: true }),
  ).rejects.toThrow("dirty")
})

async function commitDates(repoPath: string): Promise<string[]> {
  return (await runGitChecked({ repoPath, args: ["log", "--reverse", "--format=%aI%x00%cI"] })).stdout.trim().split("\n")
}
