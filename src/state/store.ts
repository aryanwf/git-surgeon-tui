import type { CommitSummary } from "../git/log"
import type { AppState, RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState } from "./types"

export function createInitialState(repoPath?: string): AppState {
  return {
    screen: repoPath ? "dashboard" : "repo-picker",
    repoPath,
    commandLog: [],
    historyQuery: "",
    selectedCommitIndex: 0,
  }
}

export function appendCommandLog(state: AppState, line: string): AppState {
  return { ...state, commandLog: [...state.commandLog, line] }
}

export function startRewordFlow(state: AppState, commit: CommitSummary): AppState {
  const flow: RewriteRewordState = {
    type: "reword",
    step: "form",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
    selectedAuthorName: commit.authorName,
    selectedAuthorEmail: commit.authorEmail,
    selectedAuthorDate: commit.authorDate,
    newMessage: commit.subject,
  }
  return { ...state, screen: "rewrite-reword", rewriteFlow: flow }
}

export function startDropFlow(state: AppState, commit: CommitSummary): AppState {
  const flow: RewriteDropState = {
    type: "drop",
    step: "confirm",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
  }
  return { ...state, screen: "rewrite-drop", rewriteFlow: flow }
}

export function startAuthorFlow(state: AppState, commit: CommitSummary): AppState {
  const flow: RewriteAuthorState = {
    type: "author",
    step: "form",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
    selectedAuthorName: commit.authorName,
    selectedAuthorEmail: commit.authorEmail,
    selectedCommitterName: commit.committerName,
    selectedCommitterEmail: commit.committerEmail,
    mode: "both",
    activeField: "name",
    newName: commit.authorName,
    newEmail: commit.authorEmail,
  }
  return { ...state, screen: "rewrite-author", rewriteFlow: flow }
}

export function startDateFlow(state: AppState, commit: CommitSummary): AppState {
  const flow: RewriteDateState = {
    type: "date",
    step: "form",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
    selectedAuthorDate: commit.authorDate,
    selectedCommitterDate: commit.committerDate,
    mode: "both",
    activeField: "date",
    newDate: commit.authorDate,
  }
  return { ...state, screen: "rewrite-date", rewriteFlow: flow }
}
