import { expect, test } from "bun:test"
import { dropSingleCommit } from "../src/git/drop"
import { runGitChecked } from "../src/git/runner"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("previews dropping a commit in a scratch clone", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await dropSingleCommit({ repoPath, sha: commits[1] })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(result.preview.droppedCommitIds).toEqual([commits[1]])
  expect(result.preview.descendants.map((commit) => commit.subject)).toEqual(["third commit"])
  expect(result.preview.oldGraph).toContain("second commit")
  expect(result.preview.newGraph).not.toContain("second commit")
  expect(result.preview.finalDiffStat).toContain("two.txt")
  expect(result.preview.finalDiffPatch).toContain("deleted file mode")
  expect(result.preview.oldMetadata).toContain("second commit")
  expect(result.preview.newMetadata).not.toContain("second commit")
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("applies dropping a commit with backup ref and operation log", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await dropSingleCommit({ repoPath, sha: commits[1], apply: true })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "third commit"])
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("drops the root commit with --root rebase", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await dropSingleCommit({ repoPath, sha: commits[0], apply: true })

  expect(await commitSubjects(repoPath)).toEqual(["second commit", "third commit"])
})

test("blocks dirty worktrees before dropping a commit", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  await expect(dropSingleCommit({ repoPath, sha: commits[1], apply: true })).rejects.toThrow("dirty")
})
