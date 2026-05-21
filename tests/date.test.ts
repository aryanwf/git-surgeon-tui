import { expect, test } from "bun:test"
import { changeOldCommitDate } from "../src/git/date"
import { runGitChecked } from "../src/git/runner"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("previews changing a commit date in a scratch clone", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await changeOldCommitDate({
    repoPath,
    sha: commits[1],
    date: "2026-05-20T10:30:00+00:00",
    mode: "both",
  })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(result.preview.newLog).toContain("2026-05-20T10:30:00Z 2026-05-20T10:30:00Z")
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("applies author date change while preserving selected committer date", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const oldCommitterDate = await commitDates(repoPath, commits[1], "%cI")

  const result = await changeOldCommitDate({
    repoPath,
    sha: commits[1],
    date: "2026-05-20T10:30:00+00:00",
    mode: "author",
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
  const changed = await commitDates(repoPath, "HEAD~1", "%aI%x00%cI")
  expect(changed).toBe(`2026-05-20T10:30:00Z\x00${oldCommitterDate}`)
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("applies committer date change while preserving selected author date", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldAuthorDate = await commitDates(repoPath, commits[1], "%aI")

  await changeOldCommitDate({
    repoPath,
    sha: commits[1],
    date: "2026-05-20T10:30:00Z",
    mode: "committer",
    apply: true,
  })

  const changed = await commitDates(repoPath, "HEAD~1", "%aI%x00%cI")
  expect(changed).toBe(`${oldAuthorDate}\x002026-05-20T10:30:00Z`)
})

test("changes the root commit date with --root rebase", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await changeOldCommitDate({
    repoPath,
    sha: commits[0],
    date: "2026-05-20T10:30:00+00:00",
    mode: "both",
    apply: true,
  })

  const changed = await commitDates(repoPath, "HEAD~2", "%aI%x00%cI")
  expect(changed).toBe("2026-05-20T10:30:00Z\x002026-05-20T10:30:00Z")
})

test("blocks invalid date input", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await expect(changeOldCommitDate({ repoPath, sha: commits[1], date: "not-a-date", mode: "both" })).rejects.toThrow("valid ISO 8601")
})

async function commitDates(repoPath: string, ref: string, format: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", `--format=${format}`, ref] })).stdout.trim()
}
