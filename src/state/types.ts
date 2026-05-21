import type { RepositoryState } from "../git/repository"

export type AppScreen = "repo-picker" | "dashboard"
  | "history"
  | "preview"
  | "size-analyzer"
  | "recovery"

export type AppState = {
  screen: AppScreen
  repoPath?: string
  repository?: RepositoryState
  error?: string
  commandLog: string[]
  historyQuery: string
  selectedCommitIndex: number
}
