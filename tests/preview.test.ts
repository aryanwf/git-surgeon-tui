import { existsSync } from "node:fs"
import { expect, test } from "bun:test"
import { createScratchClone, executeCommandPlan, renderHistoryPreview, withScratchClone } from "../src/git/preview"
import { runGitChecked } from "../src/git/runner"
import { createFixtureRepo } from "./fixtures"

test("creates disposable scratch clones without touching the source repo", async () => {
  const { repoPath } = await createFixtureRepo()
  let scratchRoot = ""

  await withScratchClone(repoPath, async (scratch) => {
    scratchRoot = scratch.rootPath
    expect(existsSync(scratch.repoPath)).toBe(true)
    await executeCommandPlan(scratch.repoPath, {
      operationType: "test-preview",
      steps: [{ label: "create preview branch", args: ["branch", "preview-only"] }],
    })
  })

  expect(existsSync(scratchRoot)).toBe(false)
  const branchResult = await runGitChecked({ repoPath, args: ["branch", "--list", "preview-only"] })
  expect(branchResult.stdout.trim()).toBe("")
})

test("disposes scratch clone handles directly", async () => {
  const { repoPath } = await createFixtureRepo()
  const scratch = await createScratchClone(repoPath)

  expect(existsSync(scratch.repoPath)).toBe(true)
  await scratch.dispose()
  expect(existsSync(scratch.rootPath)).toBe(false)
})

test("renders history preview sections with safety summary", () => {
  const rendered = renderHistoryPreview({
    oldHead: "1111111111111111111111111111111111111111",
    newHead: "2222222222222222222222222222222222222222",
    oldGraph: "* old commit\n",
    newGraph: "* new commit\n",
    diffStat: " file.txt | 1 +\n",
    diffPatch: "+new line\n",
    oldMetadata: "old metadata\n",
    newMetadata: "new metadata\n",
  }, { changedCommitCount: 2, droppedCommitIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] })

  expect(rendered.summary).toContain("Changed commits: 2")
  expect(rendered.summary).toContain("Dropped commits: aaaaaaaaaaaa")
  expect(rendered.oldGraph).toEqual(["* old commit"])
  expect(rendered.finalDiffPatch).toEqual(["+new line"])
})
