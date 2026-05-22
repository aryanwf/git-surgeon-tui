import { expect, test } from "bun:test"
import { join } from "node:path"
import { getCommitDiff, searchCommits } from "../src/git/log"
import { listBackupRefs, listReflog, parseBackupRefs, parseDanglingObjects, parseReflog, scanDanglingObjects } from "../src/git/recovery"
import { runGitChecked } from "../src/git/runner"
import { formatCommitRows } from "../src/tui/screens/history"
import { createFixtureRepo } from "./fixtures"

test("searches commit log by subject and author metadata", async () => {
  const { repoPath } = await createFixtureRepo()

  const subjectMatches = await searchCommits(repoPath, { query: "second" })
  const authorMatches = await searchCommits(repoPath, { query: "test@example.com", limit: 2 })

  expect(subjectMatches.map((commit) => commit.subject)).toEqual(["second commit"])
  expect(authorMatches).toHaveLength(2)
  expect(authorMatches[0].subject).toBe("third commit")
})

test("renders selected commit rows and selected commit diff", async () => {
  const { repoPath, commits } = await createFixtureRepo({ commitCount: 2 })
  const commitsForUi = await searchCommits(repoPath, { newestFirst: true })
  const rows = formatCommitRows(commitsForUi, 0)
  const diff = await getCommitDiff(repoPath, commits[1])

  expect(rows[0].selected).toBe(true)
  expect(rows[0].content).toContain("second commit")
  expect(diff).toContain("second commit")
  expect(diff).toContain("two.txt")
})

test("parses recovery report rows", () => {
  const sha = "a".repeat(40)
  const reflog = parseReflog(`${sha}\x00HEAD@{0}\x00commit: add file\x00Test User\x00test@example.com\x002026-01-01T00:00:00+00:00\x1e`)
  const refs = parseBackupRefs(`refs/gitsurgeon/backups/20260101/main\x00${sha}\x002026-01-01T00:00:00+00:00\x00third commit\x1erefs/gitsurgeon/backups/20260102/main\x00${sha}\x002026-01-02T00:00:00+00:00\x00newest commit\x1e`)
  const dangling = parseDanglingObjects(`dangling commit ${sha}\nunreachable blob ${"b".repeat(40)}\n`)

  expect(reflog[0]).toMatchObject({ sha, selector: "HEAD@{0}", subject: "commit: add file" })
  expect(refs.map((ref) => ref.refName)).toEqual(["refs/gitsurgeon/backups/20260102/main", "refs/gitsurgeon/backups/20260101/main"])
  expect(dangling).toEqual([
    { objectType: "commit", sha },
    { objectType: "blob", sha: "b".repeat(40) },
  ])
})

test("lists reflog, backup refs, and dangling objects read-only", async () => {
  const { repoPath, commits } = await createFixtureRepo({ commitCount: 2 })
  await runGitChecked({ repoPath, args: ["update-ref", "refs/gitsurgeon/backups/test/main", "HEAD"] })
  await Bun.write(join(repoPath, "dangling.txt"), "dangling\n")
  const danglingSha = (await runGitChecked({ repoPath, args: ["hash-object", "-w", "dangling.txt"] })).stdout.trim()

  const [reflog, backups, dangling] = await Promise.all([
    listReflog(repoPath, 5),
    listBackupRefs(repoPath),
    scanDanglingObjects(repoPath),
  ])

  expect(reflog.some((entry) => entry.sha === commits[1])).toBe(true)
  expect(backups).toContainEqual(expect.objectContaining({ refName: "refs/gitsurgeon/backups/test/main", sha: commits[1] }))
  expect(dangling).toContainEqual(expect.objectContaining({ objectType: "blob", sha: danglingSha, size: 9 }))
})
