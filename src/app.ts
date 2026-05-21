import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { validateRepository } from "./git/repository"
import { createInitialState } from "./state/store"
import type { AppState } from "./state/types"
import { DashboardScreen } from "./tui/screens/dashboard"
import { RepoPickerScreen } from "./tui/screens/repo-picker"

export type RunTuiOptions = {
  repoPath?: string
  recentRepos?: string[]
}

export async function runGitSurgeonTui(options: RunTuiOptions = {}): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  let state: AppState = createInitialState(options.repoPath)
  const pickerPaths = uniquePaths([options.repoPath, process.cwd(), ...(options.recentRepos ?? [])])

  const render = async () => {
    for (const child of renderer.root.getChildren()) child.destroyRecursively()
    if (state.screen === "dashboard" && state.repoPath) {
      try {
        const repository = await validateRepository(state.repoPath)
        state = { ...state, repository, error: undefined }
        renderer.root.add(DashboardScreen(repository))
      } catch (error) {
        state = { ...state, screen: "repo-picker", error: error instanceof Error ? error.message : String(error) }
        renderer.root.add(RepoPickerScreen(pickerPaths, selectRepo, state.error))
      }
    } else {
      renderer.root.add(RepoPickerScreen(pickerPaths, selectRepo, state.error))
    }
  }

  const selectRepo = (repoPath: string) => {
    state = { ...state, screen: "dashboard", repoPath }
    void render()
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q" || key.name === "escape") renderer.destroy()
    if (key.name === "r") void render()
  })

  await render()
}

function uniquePaths(paths: (string | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
