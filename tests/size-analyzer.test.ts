import { expect, test } from "bun:test"
import { join } from "node:path"
import { analyzeRepositorySize } from "../src/git/size-analyzer"
import { runGitChecked } from "../src/git/runner"
import { createFixtureRepo } from "./fixtures"

test("lists largest blobs by unpacked size descending", async () => {
  const { repoPath } = await createFixtureRepo()
  await commitFile(repoPath, "large.bin", "a".repeat(4096), "add large")
  await commitFile(repoPath, "medium.bin", "b".repeat(1024), "add medium")
  await runGitChecked({ repoPath, args: ["rm", "large.bin"] })
  await runGitChecked({ repoPath, args: ["commit", "-m", "delete large"] })

  const result = await analyzeRepositorySize({ repoPath })

  expect(result.rows[0].paths).toEqual(["large.bin"])
  expect(result.rows[0].unpackedSize).toBe(4096)
  expect(result.rows[0].status).toBe("deleted")
  expect(result.rows[1].paths).toEqual(["medium.bin"])
})

test("filters size analyzer rows by present and deleted paths", async () => {
  const { repoPath } = await createFixtureRepo()
  await commitFile(repoPath, "large.bin", "a".repeat(4096), "add large")
  await commitFile(repoPath, "medium.bin", "b".repeat(1024), "add medium")
  await runGitChecked({ repoPath, args: ["rm", "large.bin"] })
  await runGitChecked({ repoPath, args: ["commit", "-m", "delete large"] })

  const present = await analyzeRepositorySize({ repoPath, status: "present" })
  const deleted = await analyzeRepositorySize({ repoPath, status: "deleted" })

  expect(present.rows.some((row) => row.paths.includes("medium.bin"))).toBe(true)
  expect(present.rows.some((row) => row.paths.includes("large.bin"))).toBe(false)
  expect(deleted.rows.some((row) => row.paths.includes("large.bin"))).toBe(true)
})

test("honors the size analyzer limit", async () => {
  const { repoPath } = await createFixtureRepo()
  await commitFile(repoPath, "large.bin", "a".repeat(4096), "add large")
  await commitFile(repoPath, "medium.bin", "b".repeat(1024), "add medium")

  const result = await analyzeRepositorySize({ repoPath, limit: 1 })

  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].paths).toEqual(["large.bin"])
})

async function commitFile(repoPath: string, path: string, content: string, message: string): Promise<void> {
  await Bun.write(join(repoPath, path), content)
  await runGitChecked({ repoPath, args: ["add", path] })
  await runGitChecked({ repoPath, args: ["commit", "-m", message] })
}
