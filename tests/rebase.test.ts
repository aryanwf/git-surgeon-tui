import { expect, test } from "bun:test"
import { visualInteractiveRebase } from "../src/git/rebase"
import { runGitChecked } from "../src/git/runner"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("previews a visual rebase in a scratch clone", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [
      { sha: commits[1], action: "reword", message: "renamed second" },
      { sha: commits[2], action: "pick" },
    ],
  })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(result.preview.todo).toContain(`reword ${commits[1]}`)
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("applies visual rebase actions with backup ref and operation log", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [
      { sha: commits[2], action: "pick" },
      { sha: commits[1], action: "reword", message: "renamed second" },
    ],
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "third commit", "renamed second"])
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("drops commits through the visual rebase todo", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  const result = await visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [
      { sha: commits[1], action: "drop" },
      { sha: commits[2], action: "pick" },
    ],
    apply: true,
  })

  expect(result.preview.droppedCommitIds).toEqual([commits[1]])
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "third commit"])
})

test("squashes commits through the visual rebase todo", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [
      { sha: commits[1], action: "pick" },
      { sha: commits[2], action: "squash", message: "combined follow-up" },
    ],
    apply: true,
  })

  expect(await commitSubjects(repoPath)).toEqual(["first commit", "combined follow-up"])
})

test("blocks incomplete visual rebase todos", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await expect(visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [{ sha: commits[1], action: "pick" }],
  })).rejects.toThrow("must include every commit")
})

test("blocks dirty worktrees before visual rebase", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  await expect(visualInteractiveRebase({
    repoPath,
    base: commits[0],
    rows: [
      { sha: commits[1], action: "pick" },
      { sha: commits[2], action: "pick" },
    ],
    apply: true,
  })).rejects.toThrow("dirty")
})
