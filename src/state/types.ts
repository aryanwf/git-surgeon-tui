import type { CommitSummary } from "../git/log"
import type { RepositoryState } from "../git/repository"
import type { ChangeCommitAuthorPreview } from "../git/author"
import type { ChangeCommitDatePreview } from "../git/date"
import type { DropCommitPreview } from "../git/drop"
import type { DateChangeMode } from "../git/date"
import type { HistoryEditPreview } from "../git/history-plan"
import type { SplitCommitPreview } from "../git/split"
import type { VisualRebaseAction, VisualRebasePreview } from "../git/rebase"
import type { RenamePreview } from "../git/reword"

export type AppScreen =
  | "repo-picker"
  | "dashboard"
  | "history"
  | "preview"
  | "size-analyzer"
  | "recovery"
  | "help"
  | "rewrite-reword"
  | "rewrite-drop"
  | "rewrite-author"
  | "rewrite-date"
  | "rewrite-history-list"
  | "rewrite-split"
  | "rewrite-visual-rebase"
  | "conflict"

export type RewriteStep = "form" | "preview" | "applying" | "result"

export type HistoryListEditStep = "form" | "dirty" | "preview" | "upstream-confirm" | "applying" | "result"

// Drop commit uses "confirm" instead of "form" since there are no inputs.
export type DropStep = "confirm" | "preview" | "applying" | "result"

// Author change has an extra "warning" step before preview to surface the ethical notice.
export type AuthorStep = "form" | "warning" | "preview" | "applying" | "result"

export type RewriteRewordState = {
  type: "reword"
  step: RewriteStep
  selectedSha: string
  selectedSubject: string
  selectedAuthorName: string
  selectedAuthorEmail: string
  selectedAuthorDate: string
  // editable inputs
  newMessage: string
  // populated after scratch run
  preview?: RenamePreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type RewriteDropState = {
  type: "drop"
  step: DropStep
  selectedSha: string
  selectedSubject: string
  // populated after scratch run
  preview?: DropCommitPreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type RewriteAuthorState = {
  type: "author"
  step: AuthorStep
  selectedSha: string
  selectedSubject: string
  selectedAuthorName: string
  selectedAuthorEmail: string
  selectedCommitterName: string
  selectedCommitterEmail: string
  // editable inputs
  mode: "author" | "committer" | "both"
  activeField: "mode" | "name" | "email"
  newName: string
  newEmail: string
  // populated after scratch run
  preview?: ChangeCommitAuthorPreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type RewriteDateState = {
  type: "date"
  step: RewriteStep
  selectedSha: string
  selectedSubject: string
  selectedAuthorDate: string
  selectedCommitterDate: string
  // editable inputs
  mode: "author" | "committer" | "both"
  activeField: "mode" | "date"
  newDate: string
  // populated after scratch run
  preview?: ChangeCommitDatePreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type VisualRebaseTodoRow = {
  sha: string
  shortSha: string
  subject: string
  action: VisualRebaseAction
  message?: string
  command?: string
}

export type HistoryEditDraft = {
  sha: string
  shortSha: string
  subject: string
  authorDate: string
  message?: string
  drop?: boolean
  date?: string
  dateMode?: DateChangeMode
}

export type HistoryListEditState = {
  type: "history-list"
  step: HistoryListEditStep
  rows?: HistoryEditDraft[]
  selectedRowIndex: number
  activeField: "list" | "message" | "date"
  previewPane: "oldGraph" | "newGraph" | "metadata" | "todo" | "diff"
  previewScrollOffset: number
  upstreamConfirmation: string
  stashedRef?: string
  preview?: HistoryEditPreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type SplitCommitPartDraft = {
  message: string
}

export type SplitCommitState = {
  type: "split"
  step: RewriteStep
  selectedSha: string
  selectedSubject: string
  changedPaths?: string[]
  pathAssignments: Record<string, number>
  parts: SplitCommitPartDraft[]
  selectedPathIndex: number
  selectedPartIndex: number
  activeField: "paths" | "message"
  preview?: SplitCommitPreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type VisualRebaseState = {
  type: "visual-rebase"
  step: RewriteStep
  baseSha: string
  baseSubject: string
  rows?: VisualRebaseTodoRow[]
  selectedRowIndex: number
  activeField: "list" | "message" | "command"
  preview?: VisualRebasePreview
  backupRef?: string
  operationLogPath?: string
  pushOutput?: string
  pushError?: string
  error?: string
}

export type RewriteFlowState =
  | RewriteRewordState
  | RewriteDropState
  | RewriteAuthorState
  | RewriteDateState
  | HistoryListEditState
  | SplitCommitState
  | VisualRebaseState

export type AppState = {
  screen: AppScreen
  repoPath?: string
  repository?: RepositoryState
  error?: string
  commandLog: string[]
  repoQuery: string
  selectedRepoIndex: number
  exitPrompt: boolean
  historyQuery: string
  selectedCommitIndex: number
  historyScrollOffset: number
  // Populated during history screen render so rewrite flow triggers have the commit data.
  lastSelectedCommit?: CommitSummary
  rewriteFlow?: RewriteFlowState
  exportReportPath?: string
  exportReportError?: string
}
