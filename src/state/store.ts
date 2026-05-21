import type { AppState } from "./types"

export function createInitialState(repoPath?: string): AppState {
  return {
    screen: repoPath ? "dashboard" : "repo-picker",
    repoPath,
    commandLog: [],
  }
}

export function appendCommandLog(state: AppState, line: string): AppState {
  return { ...state, commandLog: [...state.commandLog, line] }
}
