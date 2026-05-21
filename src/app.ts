import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { getCommitDiff, searchCommits } from "./git/log"
import { validateRepository } from "./git/repository"
import { getRecoveryReport } from "./git/recovery"
import { analyzeRepositorySize } from "./git/size-analyzer"
import { createInitialState } from "./state/store"
import type { AppState } from "./state/types"
import { DashboardScreen } from "./tui/screens/dashboard"
import { HistoryScreen } from "./tui/screens/history"
import { RepoPickerScreen } from "./tui/screens/repo-picker"
import { RecoveryScreen } from "./tui/screens/recovery"
import { SizeAnalyzerScreen } from "./tui/screens/size-analyzer"

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
    if (state.repoPath && state.screen !== "repo-picker") {
      try {
        const repository = await validateRepository(state.repoPath)
        state = { ...state, repository, error: undefined }
        if (state.screen === "history") {
          const commits = await searchCommits(repository.repoPath, { query: state.historyQuery, limit: 50 })
          const selectedIndex = clamp(state.selectedCommitIndex, 0, Math.max(0, commits.length - 1))
          const diff = commits[selectedIndex] ? await getCommitDiff(repository.repoPath, commits[selectedIndex].sha) : ""
          state = { ...state, selectedCommitIndex: selectedIndex }
          renderer.root.add(HistoryScreen(repository, commits, selectedIndex, state.historyQuery, diff))
        } else if (state.screen === "size-analyzer") {
          const result = await analyzeRepositorySize({ repoPath: repository.repoPath, limit: 20 })
          renderer.root.add(SizeAnalyzerScreen(repository, result))
        } else if (state.screen === "recovery") {
          const report = await getRecoveryReport(repository.repoPath)
          renderer.root.add(RecoveryScreen(repository, report))
        } else {
          renderer.root.add(DashboardScreen(repository))
        }
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
    if (key.name === "b" && state.screen !== "repo-picker") {
      state = { ...state, screen: "dashboard" }
      void render()
    }
    if (state.screen === "dashboard") {
      if (key.name === "h") {
        state = { ...state, screen: "history", selectedCommitIndex: 0 }
        void render()
      }
      if (key.name === "s") {
        state = { ...state, screen: "size-analyzer" }
        void render()
      }
      if (key.name === "v") {
        state = { ...state, screen: "recovery" }
        void render()
      }
    } else if (state.screen === "history") {
      const nextState = handleHistoryKey(state, key)
      if (nextState !== state) {
        state = nextState
        void render()
      }
    }
  })

  await render()
}

function uniquePaths(paths: (string | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function handleHistoryKey(state: AppState, key: KeyEvent): AppState {
  if (key.name === "up" || key.name === "k") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 1) }
  }
  if (key.name === "down" || key.name === "j") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 1 }
  }
  if (key.name === "backspace" || key.name === "delete") {
    return { ...state, historyQuery: state.historyQuery.slice(0, -1), selectedCommitIndex: 0 }
  }
  if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " " && key.sequence !== "q") {
    return { ...state, historyQuery: `${state.historyQuery}${key.sequence}`, selectedCommitIndex: 0 }
  }
  return state
}
