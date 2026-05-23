import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { editCommitHistory } from "../src/git/history-plan"
import type { RepositoryState } from "../src/git/repository"
import { runGitChecked } from "../src/git/runner"
import { formatCommitRows, HistoryScreen } from "../src/tui/screens/history"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("renders a stable visible cursor after scrolling beyond the first screen", () => {
  const commits = Array.from({ length: 30 }, (_, index) => ({
    sha: `${index}`.padStart(40, "0"),
    shortSha: `${index}`.padStart(7, "0"),
    parents: [],
    authorName: "Test User",
    authorEmail: "test@example.com",
    authorDate: "2026-05-20T00:00:00Z",
    committerName: "Test User",
    committerEmail: "test@example.com",
    committerDate: "2026-05-20T00:00:00Z",
    subject: `commit ${index}`,
    refs: [],
  }))

  const rows = formatCommitRows(commits, 24, 0, 10)

  expect(rows).toHaveLength(10)
  expect(rows.some((row) => row.selected)).toBe(true)
  expect(rows.find((row) => row.selected)?.content).toContain("commit 24")
  expect(rows[0].content).toContain("16")
})

test("OpenTUI test renderer captures the scroll-windowed history screen", async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 120, height: 32 })
  try {
    const commits = Array.from({ length: 24 }, (_, index) => ({
      sha: `${index}`.padStart(40, "0"),
      shortSha: `${index}`.padStart(7, "0"),
      parents: [],
      authorName: "Test User",
      authorEmail: "test@example.com",
      authorDate: "2026-05-20T00:00:00Z",
      committerName: "Test User",
      committerEmail: "test@example.com",
      committerDate: "2026-05-20T00:00:00Z",
      subject: `commit ${index}`,
      refs: [],
    }))
    renderer.root.add(HistoryScreen(fakeRepositoryState(), commits, 20, 12, "", 0, "diff --git a/file b/file\n+new"))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toContain("History And Diff")
    expect(frame).toContain("commit 20")
    expect(frame).not.toContain("commit 0")
  } finally {
    renderer.destroy()
  }
})

test("applies a batched list edit with rename plus drop plus date change", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const originalFirstDate = await commitDates(repoPath, commits[0], "%aI%x00%cI")

  const result = await editCommitHistory({
    repoPath,
    operations: [
      { sha: commits[0], message: "renamed first" },
      { sha: commits[1], drop: true },
      { sha: commits[2], date: "2026-05-20T10:30:00Z", dateMode: "both" },
    ],
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(result.preview.todo).toContain(`edit ${commits[0]}`)
  expect(result.preview.todo).toContain(`drop ${commits[1]}`)
  expect(result.preview.todo).toContain(`edit ${commits[2]}`)
  expect(result.preview.droppedCommitIds).toEqual([commits[1]])
  expect(Object.keys(result.preview.oldToNew)).toHaveLength(2)
  expect(await commitSubjects(repoPath)).toEqual(["renamed first", "third commit"])
  expect(await commitDates(repoPath, "HEAD~1", "%aI%x00%cI")).toBe(originalFirstDate)
  expect(await commitDates(repoPath, "HEAD", "%aI%x00%cI")).toBe("2026-05-20T10:30:00Z\x002026-05-20T10:30:00Z")
  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("renames commit messages without changing metadata or running commit hooks", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldMetadata = await allCommitMetadata(repoPath)
  const hookPath = (await runGitChecked({ repoPath, args: ["rev-parse", "--git-path", "hooks/prepare-commit-msg"] })).stdout.trim()
  await Bun.write(hookPath, "#!/bin/sh\nprintf '\\nCo-authored-by: Hook User <hook@example.com>\\n' >> \"$1\"\n")
  await Bun.spawn(["chmod", "+x", hookPath]).exited

  await editCommitHistory({
    repoPath,
    operations: [{ sha: commits[1], message: "renamed second commit" }],
    apply: true,
  })

  const newMetadata = await allCommitMetadata(repoPath)
  expect(newMetadata.map(withoutSubject)).toEqual(oldMetadata.map(withoutSubject))
  expect(newMetadata.map((row) => row.subject)).toEqual(["first commit", "renamed second commit", "third commit"])
  expect((await runGitChecked({ repoPath, args: ["log", "--format=%B"] })).stdout).not.toContain("Co-authored-by: Hook User")
})

async function commitDates(repoPath: string, ref: string, format: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", `--format=${format}`, ref] })).stdout.trim()
}

async function allCommitMetadata(repoPath: string): Promise<Array<{ authorName: string; authorEmail: string; authorDate: string; committerName: string; committerEmail: string; committerDate: string; subject: string }>> {
  const format = "%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x1e"
  const output = (await runGitChecked({ repoPath, args: ["log", "--reverse", `--format=${format}`] })).stdout
  return output.split("\x1e").map((row) => row.trim()).filter(Boolean).map((row) => {
    const [authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, subject] = row.split("\x00")
    return { authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, subject }
  })
}

function withoutSubject(row: Awaited<ReturnType<typeof allCommitMetadata>>[number]) {
  return {
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    authorDate: row.authorDate,
    committerName: row.committerName,
    committerEmail: row.committerEmail,
    committerDate: row.committerDate,
  }
}

function fakeRepositoryState(): RepositoryState {
  return {
    repoPath: "/tmp/repo",
    gitDir: "/tmp/repo/.git",
    gitCommonDir: "/tmp/repo/.git",
    branch: "main",
    head: "0".repeat(40),
    statusPorcelain: "",
    rebaseInProgress: false,
    mergeInProgress: false,
    cherryPickInProgress: false,
    revertInProgress: false,
    dirty: false,
    operationStatus: "ready",
  }
}
