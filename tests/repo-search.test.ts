import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "bun:test"
import { filterValidRepoPaths } from "../src/git/repo-search"
import { createFixtureRepo } from "./fixtures"

test("repository path filtering drops invalid paths and deduplicates to roots", async () => {
  const { repoPath } = await createFixtureRepo()
  const subdir = join(repoPath, "nested")
  await mkdir(subdir)

  const paths = await filterValidRepoPaths([join(repoPath, "missing"), subdir, repoPath, "path"])

  expect(paths).toEqual([repoPath])
})
