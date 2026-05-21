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

async function commitDates(repoPath: string, ref: string, format: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", `--format=${format}`, ref] })).stdout.trim()
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
