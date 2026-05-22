import type { CommitSummary } from "../git/log"
import type { AppState, HistoryListEditState, RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState, SplitCommitState, VisualRebaseState } from "./types"

export function createInitialState(repoPath?: string): AppState {
  return {
    screen: repoPath ? "dashboard" : "repo-picker",
    repoPath,
    commandLog: [],
    repoQuery: "",
    repoQueryCursor: 0,
    selectedRepoIndex: 0,
    selectedRecoveryBackupIndex: 0,
    exitPrompt: false,
    historyQuery: "",
    historyQueryCursor: 0,
    historyFilterActive: false,
    selectedCommitIndex: 0,
    historyScrollOffset: 0,
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
    newMessageCursor: commit.subject.length,
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
    newNameCursor: commit.authorName.length,
    newEmail: commit.authorEmail,
    newEmailCursor: commit.authorEmail.length,
  }
  return { ...state, screen: "rewrite-author", rewriteFlow: flow }
}

export function startDateFlow(state: AppState, commit: CommitSummary): AppState {
  const dateParts = parseDateParts(commit.authorDate)
  const flow: RewriteDateState = {
    type: "date",
    step: "form",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
    selectedAuthorDate: commit.authorDate,
    selectedCommitterDate: commit.committerDate,
    mode: "both",
    activeField: "year",
    dateYear: dateParts.year,
    dateYearCursor: dateParts.year.length,
    dateMonth: dateParts.month,
    dateMonthCursor: dateParts.month.length,
    dateDay: dateParts.day,
    dateDayCursor: dateParts.day.length,
    dateHour: dateParts.hour,
    dateHourCursor: dateParts.hour.length,
    dateMinute: dateParts.minute,
    dateMinuteCursor: dateParts.minute.length,
    dateSecond: dateParts.second,
    dateSecondCursor: dateParts.second.length,
    timezone: dateParts.timezone,
  }
  return { ...state, screen: "rewrite-date", rewriteFlow: flow }
}

function parseDateParts(value: string): { year: string; month: string; day: string; hour: string; minute: string; second: string; timezone: string } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/)
  if (match) {
    return {
      year: match[1],
      month: match[2],
      day: match[3],
      hour: match[4],
      minute: match[5],
      second: match[6],
      timezone: match[7] === "Z" ? "Z" : `${match[7].slice(0, 3)}:${match[7].slice(-2)}`,
    }
  }

  const fallback = new Date(value)
  if (Number.isNaN(fallback.getTime())) {
    return { year: "", month: "", day: "", hour: "", minute: "", second: "", timezone: "Z" }
  }
  return {
    year: String(fallback.getUTCFullYear()).padStart(4, "0"),
    month: String(fallback.getUTCMonth() + 1).padStart(2, "0"),
    day: String(fallback.getUTCDate()).padStart(2, "0"),
    hour: String(fallback.getUTCHours()).padStart(2, "0"),
    minute: String(fallback.getUTCMinutes()).padStart(2, "0"),
    second: String(fallback.getUTCSeconds()).padStart(2, "0"),
    timezone: "Z",
  }
}

export function startHistoryListEditFlow(state: AppState): AppState {
  const flow: HistoryListEditState = {
    type: "history-list",
    step: "form",
    selectedRowIndex: state.selectedCommitIndex,
    activeField: "list",
    previewPane: "oldGraph",
    previewScrollOffset: 0,
    upstreamConfirmation: "",
    upstreamConfirmationCursor: 0,
  }
  return { ...state, screen: "rewrite-history-list", rewriteFlow: flow }
}

export function startSplitFlow(state: AppState, commit: CommitSummary): AppState {
  const flow: SplitCommitState = {
    type: "split",
    step: "form",
    selectedSha: commit.sha,
    selectedSubject: commit.subject,
    pathAssignments: {},
    parts: [
      { message: `${commit.subject} (part 1)`, messageCursor: `${commit.subject} (part 1)`.length },
      { message: `${commit.subject} (part 2)`, messageCursor: `${commit.subject} (part 2)`.length },
    ],
    selectedPathIndex: 0,
    selectedPartIndex: 0,
    activeField: "paths",
  }
  return { ...state, screen: "rewrite-split", rewriteFlow: flow }
}

export function startVisualRebaseFlow(state: AppState, baseCommit: CommitSummary): AppState {
  const flow: VisualRebaseState = {
    type: "visual-rebase",
    step: "form",
    baseSha: baseCommit.sha,
    baseSubject: baseCommit.subject,
    selectedRowIndex: 0,
    activeField: "list",
  }
  return { ...state, screen: "rewrite-visual-rebase", rewriteFlow: flow }
}
