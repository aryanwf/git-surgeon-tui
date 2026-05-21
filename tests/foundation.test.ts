import { expect, test } from "bun:test"
import { runGit, runGitChecked } from "../src/git/runner"
import { validateRepository } from "../src/git/repository"
import { dashboardRows } from "../src/tui/screens/dashboard"
import { buildRepoPickerOptions } from "../src/tui/screens/repo-picker"
import { createInitialState } from "../src/state/store"
import { createFixtureRepo } from "./fixtures"

test("GitRunner streams stdout and records structured results", async () => {
  const { repoPath } = await createFixtureRepo({ commitCount: 1 })
  let streamed = ""

  const result = await runGit({
    repoPath,
    args: ["rev-parse", "--short", "HEAD"],
    onStdout: (chunk) => {
      streamed += chunk
    },
  })

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe(streamed)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  expect(result.timedOut).toBe(false)
  expect(result.cancelled).toBe(false)
})

test("repository validation returns dashboard foundation state", async () => {
  const { repoPath, commits } = await createFixtureRepo({ commitCount: 1 })
  const state = await validateRepository(repoPath)

  expect(state.repoPath).toBe(repoPath)
  expect(state.branch).toBe("main")
  expect(state.head).toBe(commits[0])
  expect(state.dirty).toBe(false)
  expect(state.operationStatus).toBe("ready")
  expect(dashboardRows(state)).toContainEqual(["Status", "ready"])
})

test("repository validation surfaces dirty worktrees", async () => {
  const { repoPath } = await createFixtureRepo({ commitCount: 1 })
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  const state = await validateRepository(repoPath)

  expect(state.dirty).toBe(true)
  expect(state.operationStatus).toBe("dirty")
})

test("repo picker and initial state model TUI startup", async () => {
  const { repoPath } = await createFixtureRepo({ commitCount: 1 })
  const options = buildRepoPickerOptions([repoPath])

  expect(createInitialState().screen).toBe("repo-picker")
  expect(createInitialState(repoPath).screen).toBe("dashboard")
  expect(options).toEqual([{ name: repoPath, description: "Open and validate this Git repository", value: repoPath }])
})

test("GitRunner supports stdin", async () => {
  const { repoPath } = await createFixtureRepo({ commitCount: 1 })
  const result = await runGitChecked({ repoPath, args: ["hash-object", "--stdin"], stdin: "hello\n" })

  expect(result.stdout.trim()).toHaveLength(40)
})
