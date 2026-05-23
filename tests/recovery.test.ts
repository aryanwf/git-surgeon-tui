import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, test } from "bun:test"
import { pushBackupToUpstream } from "../src/git/recovery"
import { runGitChecked } from "../src/git/runner"
import { createFixtureRepo } from "./fixtures"

test("applying a backup updates both local branch and upstream", async () => {
  const { repoPath } = await createFixtureRepo()
  const remotePath = await mkdtemp(join(tmpdir(), "gitsurgeon-remote-"))
  await runGitChecked({ args: ["init", "--bare", remotePath] })
  await runGitChecked({ repoPath, args: ["remote", "add", "origin", remotePath] })
  await runGitChecked({ repoPath, args: ["push", "-u", "origin", "main"] })

  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const backupRef = "refs/gitsurgeon/backups/test/main"
  await runGitChecked({ repoPath, args: ["update-ref", backupRef, "HEAD"] })

  await Bun.write(join(repoPath, "four.txt"), "four\n")
  await runGitChecked({ repoPath, args: ["add", "four.txt"] })
  await runGitChecked({ repoPath, args: ["commit", "-m", "fourth commit"] })
  await runGitChecked({ repoPath, args: ["push", "origin", "HEAD:main"] })
  expect((await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()).not.toBe(backupHead)

  await pushBackupToUpstream(repoPath, backupRef, "origin/main")

  expect((await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()).toBe(backupHead)
  expect((await runGitChecked({ repoPath, args: ["rev-parse", "origin/main"] })).stdout.trim()).toBe(backupHead)
})
