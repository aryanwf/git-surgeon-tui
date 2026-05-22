import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import type { HistoryEditDraft, HistoryListEditState, RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState, SplitCommitState, VisualRebaseState, VisualRebaseTodoRow } from "../../state/types"
import { KeyHelp } from "../components/key-help"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

// Reword

export function RewordFlowScreen(state: RepositoryState, flow: RewriteRewordState) {
  if (flow.step === "form") return RewordFormScreen(state, flow)
  if (flow.step === "preview") return RewordPreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Renaming commit message…")
  return RewordResultScreen(state, flow)
}

function RewordFormScreen(state: RepositoryState, flow: RewriteRewordState) {
  return AppFrame(
    "Rename Commit Message",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      commitInfoBox(flow.selectedSha, flow.selectedSubject, flow.selectedAuthorName, flow.selectedAuthorEmail, flow.selectedAuthorDate),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "New message:", fg: theme.accent }),
        Text({ content: editableText(flow.newMessage, true, flow.newMessageCursor), fg: theme.text }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["type", "edit commit name"],
      ["backspace", "delete text"],
      ["enter", "preview change"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function RewordPreviewScreen(state: RepositoryState, flow: RewriteRewordState) {
  const p = flow.preview
  return AppFrame(
    "Rename Commit Message — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before", p?.oldGraph ?? "(computing…)", theme.danger, 14),
        previewPanel("After", p?.newGraph ?? "(computing…)", theme.ok, 14),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to edit form"],
    ]),
    StatusBar(state),
  )
}

function RewordResultScreen(state: RepositoryState, flow: RewriteRewordState) {
  if (flow.error) {
    return AppFrame(
      "Rename Commit Message — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.preview?.backupRef ? [Text({ content: `Backup ref preserved: ${flow.preview.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Rename Commit Message — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit message renamed successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}

// Drop Commit

export function DropCommitFlowScreen(state: RepositoryState, flow: RewriteDropState) {
  if (flow.step === "confirm") return DropConfirmScreen(state, flow)
  if (flow.step === "preview") return DropPreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Dropping commit…")
  return DropResultScreen(state, flow)
}

function DropConfirmScreen(state: RepositoryState, flow: RewriteDropState) {
  const p = flow.preview
  const descendants = p?.descendants ?? flow.descendants
  return AppFrame(
    "Drop Commit",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: "Commit to be dropped:", fg: theme.danger }),
        Text({ content: `  ${flow.selectedSha.slice(0, 10)}  ${flow.selectedSubject}`, fg: theme.text }),
      ),
      descendants === undefined
        ? Text({ content: "Checking descendant commits...", fg: theme.muted })
        : descendants.length > 0
        ? Box(
            { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
            Text({ content: `${descendants.length} descendant commit(s) will be rewritten:`, fg: theme.accent }),
            ...descendants.slice(0, 8).map((c) => Text({ content: `  ${c.shortSha.padEnd(10)} ${truncate(c.subject, 64)}`, fg: theme.muted })),
          )
        : Text({ content: "No descendant commits.", fg: theme.muted }),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["enter", "preview drop"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function DropPreviewScreen(state: RepositoryState, flow: RewriteDropState) {
  const p = flow.preview
  return AppFrame(
    "Drop Commit — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before", p?.oldGraph ?? "(computing…)", theme.danger, 14),
        previewPanel("After", p?.newGraph ?? "(computing…)", theme.ok, 14),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to confirmation"],
    ]),
    StatusBar(state),
  )
}

function DropResultScreen(state: RepositoryState, flow: RewriteDropState) {
  if (flow.error) {
    return AppFrame(
      "Drop Commit — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Drop Commit — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit dropped successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// Change Author

export function ChangeAuthorFlowScreen(state: RepositoryState, flow: RewriteAuthorState) {
  if (flow.step === "form") return AuthorFormScreen(state, flow)
  if (flow.step === "warning") return AuthorWarningScreen(state, flow)
  if (flow.step === "preview") return AuthorPreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Changing author metadata…")
  return AuthorResultScreen(state, flow)
}

function AuthorFormScreen(state: RepositoryState, flow: RewriteAuthorState) {
  const modes: Array<"author" | "committer" | "both"> = ["author", "committer", "both"]
  const modeIndex = modes.indexOf(flow.mode)

  return AppFrame(
    "Change Commit Author",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      commitInfoBox(flow.selectedSha, flow.selectedSubject, flow.selectedAuthorName, flow.selectedAuthorEmail),
      Box(
        { flexDirection: "row", gap: 1 },
        inputField("Name", flow.newName, flow.activeField === "name", flow.newNameCursor),
        inputField("Email", flow.newEmail, flow.activeField === "email", flow.newEmailCursor),
      ),
      Box(
        { flexDirection: "row", gap: 1 },
        Text({ content: `Mode: `, fg: theme.muted }),
        ...modes.map((m, i) =>
          Text({ content: ` ${m} `, fg: i === modeIndex ? theme.accent : theme.muted }),
        ),
        Text({ content: flow.activeField === "mode" ? `  (←/→ to change)` : `  (tab to mode)`, fg: flow.activeField === "mode" ? theme.accent : theme.muted }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["tab", "next field or mode"],
      ["←/→", "move cursor or mode"],
      ["enter", "continue"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function AuthorWarningScreen(state: RepositoryState, flow: RewriteAuthorState) {
  return AppFrame(
    "Change Commit Author — Warning",
    Box(
      { flexDirection: "column", gap: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: "Attribution Warning", fg: theme.danger }),
        Text({ content: "This operation rewrites commit authorship metadata.", fg: theme.text }),
        Text({ content: "The change is permanent and visible to all future readers of this repository.", fg: theme.text }),
        Text({ content: "If this history has been pushed, you will need a coordinated force-push.", fg: theme.text }),
      ),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "Proposed change:", fg: theme.accent }),
        Text({ content: `  Commit:  ${flow.selectedSha.slice(0, 10)}  ${truncate(flow.selectedSubject, 60)}`, fg: theme.text }),
        Text({ content: `  Mode:    ${flow.mode}`, fg: theme.text }),
        Text({ content: `  New:     ${flow.newName} <${flow.newEmail}>`, fg: theme.text }),
      ),
    ),
    KeyHelp([
      ["enter", "preview author change"],
      ["esc", "back to author form"],
    ]),
    StatusBar(state),
  )
}

function AuthorPreviewScreen(state: RepositoryState, flow: RewriteAuthorState) {
  const p = flow.preview
  return AppFrame(
    "Change Commit Author — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before", p?.oldLog ?? "(computing…)", theme.danger, 10),
        previewPanel("After", p?.newLog ?? "(computing…)", theme.ok, 10),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to warning"],
    ]),
    StatusBar(state),
  )
}

function AuthorResultScreen(state: RepositoryState, flow: RewriteAuthorState) {
  if (flow.error) {
    return AppFrame(
      "Change Commit Author — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Change Commit Author — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Author metadata changed successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// Change Date

export function ChangeDateFlowScreen(state: RepositoryState, flow: RewriteDateState) {
  if (flow.step === "form") return DateFormScreen(state, flow)
  if (flow.step === "preview") return DatePreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Changing commit date…")
  return DateResultScreen(state, flow)
}

function DateFormScreen(state: RepositoryState, flow: RewriteDateState) {
  const modes: Array<"author" | "committer" | "both"> = ["author", "committer", "both"]
  const modeIndex = modes.indexOf(flow.mode)
  const timezoneOptions = ["Z", "-12:00", "-08:00", "-05:00", "+00:00", "+01:00", "+05:30", "+08:00", "+09:00", "+12:00"]

  return AppFrame(
    "Change Commit Date",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      commitInfoBox(flow.selectedSha, flow.selectedSubject),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: `Current author date:    ${flow.selectedAuthorDate}`, fg: theme.muted }),
        Text({ content: `Current committer date: ${flow.selectedCommitterDate}`, fg: theme.muted }),
      ),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "New date and time", fg: theme.accent }),
        Box(
          { flexDirection: "row", gap: 1 },
          compactDateField("Year", flow.dateYear, flow.activeField === "year", flow.dateYearCursor),
          compactDateField("Month", flow.dateMonth, flow.activeField === "month", flow.dateMonthCursor),
          compactDateField("Day", flow.dateDay, flow.activeField === "day", flow.dateDayCursor),
        ),
        Box(
          { flexDirection: "row", gap: 1 },
          compactDateField("Hour", flow.dateHour, flow.activeField === "hour", flow.dateHourCursor),
          compactDateField("Minute", flow.dateMinute, flow.activeField === "minute", flow.dateMinuteCursor),
          compactDateField("Second", flow.dateSecond, flow.activeField === "second", flow.dateSecondCursor),
        ),
        Text({ content: `Timezone: ${timezoneOptions.map((tz) => tz === flow.timezone ? `[${tz}]` : tz).join(" ")}`, fg: flow.activeField === "timezone" ? theme.accent : theme.muted }),
        Text({ content: `Preview: ${formattedDateFromFlow(flow)}`, fg: theme.muted }),
      ),
      Box(
        { flexDirection: "row", gap: 1 },
        Text({ content: "Mode: ", fg: theme.muted }),
        ...modes.map((m, i) =>
          Text({ content: ` ${m} `, fg: i === modeIndex ? theme.accent : theme.muted }),
        ),
        Text({ content: flow.activeField === "mode" ? "  (←/→ to change)" : "  (tab to mode)", fg: flow.activeField === "mode" ? theme.accent : theme.muted }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["type", "edit selected box"],
      ["tab", "next box"],
      ["←/→", "move cursor or selector"],
      ["enter", "preview date change"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function DatePreviewScreen(state: RepositoryState, flow: RewriteDateState) {
  const p = flow.preview
  return AppFrame(
    "Change Commit Date — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before (dates)", p?.oldLog ?? "(computing…)", theme.danger, 10),
        previewPanel("After (dates)", p?.newLog ?? "(computing…)", theme.ok, 10),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to date form"],
    ]),
    StatusBar(state),
  )
}

function DateResultScreen(state: RepositoryState, flow: RewriteDateState) {
  if (flow.error) {
    return AppFrame(
      "Change Commit Date — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Change Commit Date — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit date changed successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// List-Based History Edit

export function HistoryListEditFlowScreen(state: RepositoryState, flow: HistoryListEditState) {
  if (flow.step === "dirty") return HistoryListDirtyScreen(state, flow)
  if (flow.step === "preview") return HistoryListPreviewScreen(state, flow)
  if (flow.step === "upstream-confirm") return HistoryListUpstreamConfirmScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Applying combined history edit...")
  if (flow.step === "result") return HistoryListResultScreen(state, flow)
  return HistoryListFormScreen(state, flow)
}

function HistoryListFormScreen(state: RepositoryState, flow: HistoryListEditState) {
  const rows = flow.rows ?? []
  const selected = rows[flow.selectedRowIndex]
  const dropCount = rows.filter((row) => row.drop).length
  const changedCount = rows.filter((row) => row.drop || row.message !== undefined || row.date !== undefined).length
  const descendantCount = firstDropDescendants(rows).length
  return AppFrame(
    "List History Edit",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1, flexGrow: 1 },
        Box(
          { flexDirection: "column", width: "62%", borderStyle: "single", borderColor: theme.border, padding: 1 },
          Text({ content: `Commits newest to oldest (${rows.length})`, fg: theme.accent }),
          ...historyEditRows(rows, flow.selectedRowIndex),
        ),
        Box(
          { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: flow.activeField === "list" ? theme.border : theme.accent, padding: 1 },
          Text({ content: selected ? `${selected.shortSha} ${truncate(selected.subject, 68)}` : "Loading commits...", fg: theme.accent }),
          ...(selected ? historyEditDetails(selected, flow.activeField) : [Text({ content: "Preparing editable history list.", fg: theme.muted })]),
          Text({ content: "", fg: theme.muted }),
          Text({ content: `Pending edits: ${changedCount}   drops: ${dropCount}`, fg: changedCount > 0 ? theme.ok : theme.muted }),
          ...(dropCount > 0 ? [Text({ content: `${descendantCount} descendant commit(s) will be rewritten after the oldest drop.`, fg: theme.danger })] : []),
        ),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["↑/↓", "select commit"],
      ["w", "edit commit name"],
      ["t", "edit commit date"],
      ["x", "drop commit"],
      ["c", "clear row edits"],
      ["enter", "preview changes"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function HistoryListDirtyScreen(state: RepositoryState, flow: HistoryListEditState) {
  return AppFrame(
    "Dirty Worktree",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: "The worktree or index has local changes.", fg: theme.danger }),
        Text({ content: "Choose how to handle them before the scratch preview runs.", fg: theme.text }),
      ),
      Text({ content: "s: stash local changes with git stash push -u", fg: theme.text }),
      Text({ content: "m: commit manually and return to history", fg: theme.text }),
      Text({ content: "c: cancel", fg: theme.text }),
      Text({ content: "esc: back to edit list", fg: theme.text }),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    StatusBar(state),
  )
}

function HistoryListPreviewScreen(state: RepositoryState, flow: HistoryListEditState) {
  const p = flow.preview
  const pane = previewPaneContent(flow)
  const lines = pane.content.split("\n").filter((line) => line.trim() !== "")
  const visible = lines.slice(flow.previewScrollOffset, flow.previewScrollOffset + 18)
  return AppFrame(
    "List History Edit Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        ...(["oldGraph", "newGraph", "metadata", "todo", "diff"] as const).map((name) => Text({ content: ` ${name} `, fg: flow.previewPane === name ? theme.accent : theme.muted })),
      ),
      Box(
        { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: pane.title, fg: theme.accent }),
        ...(p ? visible.map((line) => Text({ content: truncate(line, 110), fg: previewLineColor(line) })) : [Text({ content: "Computing scratch preview...", fg: theme.muted })]),
      ),
      ...(p ? [Text({ content: `Affected commits: ${p.changedCommitCount}   dropped: ${p.droppedCommitIds.length}   scroll: ${flow.previewScrollOffset + 1}/${Math.max(1, lines.length)}`, fg: theme.muted })] : []),
      ...(p ? oldToNewLines(p.oldToNew) : []),
      warningsBox(p?.warnings ?? []),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["tab", "switch preview pane"],
      ["↑/↓", "scroll preview"],
      ["enter", "apply after preview succeeds"],
      ["esc", "back to edit list"],
    ]),
    StatusBar(state),
  )
}

function HistoryListUpstreamConfirmScreen(state: RepositoryState, flow: HistoryListEditState) {
  const phrase = `rewrite ${state.branch}`
  return AppFrame(
    "Published History Confirmation",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: `Current branch tracks ${state.upstream}.`, fg: theme.danger }),
        Text({ content: "This applies the local rewrite, then runs git push -f.", fg: theme.text }),
        Text({ content: `Type exactly: ${phrase}`, fg: theme.accent }),
      ),
      Text({ content: editableText(flow.upstreamConfirmation, true, flow.upstreamConfirmationCursor), fg: theme.text }),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["type", "enter confirmation phrase"],
      ["enter", "apply rewrite"],
      ["esc", "back to preview"],
    ]),
    StatusBar(state),
  )
}

function HistoryListResultScreen(state: RepositoryState, flow: HistoryListEditState) {
  if (flow.error) {
    return AppFrame(
      "List History Edit Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "List History Edit Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Combined history edit applied successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
      ...(flow.stashedRef ? [Text({ content: `Local changes were stashed: ${flow.stashedRef}`, fg: theme.muted })] : []),
      Text({ content: "Recovery: create a branch from the backup ref or reset to it from the Recovery Viewer.", fg: theme.muted }),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// Split Commit

export function SplitCommitFlowScreen(state: RepositoryState, flow: SplitCommitState) {
  if (flow.step === "form") return SplitCommitFormScreen(state, flow)
  if (flow.step === "preview") return SplitCommitPreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Splitting commit...")
  return SplitCommitResultScreen(state, flow)
}

function SplitCommitFormScreen(state: RepositoryState, flow: SplitCommitState) {
  const paths = flow.changedPaths ?? []
  const selectedPath = paths[flow.selectedPathIndex]
  const selectedPart = flow.parts[flow.selectedPartIndex]
  return AppFrame(
    "Split Commit",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      commitInfoBox(flow.selectedSha, flow.selectedSubject),
      Box(
        { flexDirection: "row", gap: 1, flexGrow: 1 },
        Box(
          { flexDirection: "column", width: "56%", borderStyle: "single", borderColor: flow.activeField === "paths" ? theme.accent : theme.border, padding: 1 },
          Text({ content: "Changed files", fg: theme.accent }),
          ...(flow.changedPaths ? splitPathLines(paths, flow) : [Text({ content: "Loading changed paths...", fg: theme.muted })]),
        ),
        Box(
          { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: flow.activeField === "message" ? theme.accent : theme.border, padding: 1 },
          Text({ content: `Part ${flow.selectedPartIndex + 1} message`, fg: theme.accent }),
          Text({ content: editableText(selectedPart?.message ?? "", flow.activeField === "message", selectedPart?.messageCursor), fg: theme.text }),
          Text({ content: "", fg: theme.muted }),
          ...splitPartSummary(paths, flow),
          ...(selectedPath ? [Text({ content: `Selected file goes to part ${(flow.pathAssignments[selectedPath] ?? 0) + 1}`, fg: theme.muted })] : []),
        ),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["↑/↓", "select file"],
      ["←/→", "assign selected file"],
      ["tab", "edit part message"],
      ["[ / ]", "select commit part"],
      ["n", "add commit part"],
      ["x", "remove commit part"],
      ["enter", "preview split"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function SplitCommitPreviewScreen(state: RepositoryState, flow: SplitCommitState) {
  const p = flow.preview
  return AppFrame(
    "Split Commit — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before", p?.oldGraph ?? "(computing...)", theme.danger, 10),
        previewPanel("After", p?.newGraph ?? "(computing...)", theme.ok, 10),
      ),
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Split commits", p?.splitCommitIds.join("\n") ?? "(computing...)", theme.text, 8),
        previewPanel("Final diff stat", p?.finalDiffStat ?? "(computing...)", theme.text, 8),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to split form"],
    ]),
    StatusBar(state),
  )
}

function SplitCommitResultScreen(state: RepositoryState, flow: SplitCommitState) {
  if (flow.error) {
    return AppFrame(
      "Split Commit — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Split Commit — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit split successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// Visual Interactive Rebase

export function VisualRebaseFlowScreen(state: RepositoryState, flow: VisualRebaseState) {
  if (flow.step === "form") return VisualRebaseFormScreen(state, flow)
  if (flow.step === "preview") return VisualRebasePreviewScreen(state, flow)
  if (flow.step === "applying") return ApplyingScreen(state, "Applying visual interactive rebase...")
  return VisualRebaseResultScreen(state, flow)
}

function VisualRebaseFormScreen(state: RepositoryState, flow: VisualRebaseState) {
  const rows = flow.rows ?? []
  const selected = rows[flow.selectedRowIndex]
  return AppFrame(
    "Visual Interactive Rebase",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "Range base (excluded):", fg: theme.accent }),
        Text({ content: `  ${flow.baseSha.slice(0, 10)}  ${truncate(flow.baseSubject, 72)}`, fg: theme.text }),
      ),
      Box(
        { flexDirection: "row", gap: 1, flexGrow: 1 },
        Box(
          { flexDirection: "column", width: "62%", borderStyle: "single", borderColor: theme.border, padding: 1 },
          Text({ content: "Todo (oldest to newest)", fg: theme.accent }),
          ...visualTodoLines(rows, flow.selectedRowIndex),
        ),
        Box(
          { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
          Text({ content: selected ? `${selected.shortSha} ${selected.action}` : "No commit selected", fg: theme.accent }),
          ...(selected ? selectedDetails(selected, flow.activeField) : [Text({ content: "Select a base with commits after it.", fg: theme.muted })]),
        ),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    KeyHelp([
      ["↑/↓", "select commit"],
      ["←/→", "change action"],
      ["x", "drop commit"],
      ["[ / ]", "reorder commit"],
      ["e", "edit commit name"],
      ["c", "edit exec command"],
      ["enter", "preview rebase"],
      ["esc", "back to history"],
    ]),
    StatusBar(state),
  )
}

function VisualRebasePreviewScreen(state: RepositoryState, flow: VisualRebaseState) {
  const p = flow.preview
  return AppFrame(
    "Visual Interactive Rebase — Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Before", p?.oldGraph ?? "(computing...)", theme.danger, 10),
        previewPanel("After", p?.newGraph ?? "(computing...)", theme.ok, 10),
      ),
      Box(
        { flexDirection: "row", gap: 1 },
        previewPanel("Generated todo", p?.todo ?? "(computing...)", theme.text, 8),
        previewPanel("Diff stat", p?.finalDiffStat ?? "(computing...)", theme.text, 8),
      ),
      warningsBox(p?.warnings ?? []),
    ),
    KeyHelp([
      ["enter", "apply to real repo"],
      ["esc", "back to rebase form"],
    ]),
    StatusBar(state),
  )
}

function VisualRebaseResultScreen(state: RepositoryState, flow: VisualRebaseState) {
  if (flow.error) {
    return AppFrame(
      "Visual Interactive Rebase — Failed",
      Box(
        { flexDirection: "column", gap: 1 },
        Text({ content: `Error: ${flow.error}`, fg: theme.danger }),
        ...(flow.backupRef ? [Text({ content: `Backup ref preserved: ${flow.backupRef}`, fg: theme.ok })] : []),
      ),
      KeyHelp([["b / esc", "back to history"]]),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Visual Interactive Rebase — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Visual interactive rebase applied successfully.", fg: theme.ok }),
      ...(flow.pushOutput ? [Text({ content: `Remote update: ${flow.pushOutput}`, fg: theme.ok })] : []),
      ...(flow.pushError ? [Text({ content: flow.pushError, fg: theme.danger })] : []),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    KeyHelp([["b / esc", "back to history"]]),
    StatusBar(state),
  )
}



// Shared helpers

function ApplyingScreen(state: RepositoryState, message: string) {
  return AppFrame(
    "Working…",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1, justifyContent: "center", alignItems: "center" },
      Text({ content: message, fg: theme.accent }),
      Text({ content: "Running in scratch clone first, then applying to real repo.", fg: theme.muted }),
    ),
    StatusBar(state),
  )
}

function commitInfoBox(sha: string, subject: string, authorName?: string, authorEmail?: string, authorDate?: string) {
  const lines = [
    Text({ content: `Commit:  ${sha.slice(0, 12)}`, fg: theme.text }),
    Text({ content: `Subject: ${truncate(subject, 72)}`, fg: theme.text }),
  ]
  if (authorName) lines.push(Text({ content: `Author:  ${authorName} <${authorEmail ?? ""}>`, fg: theme.muted }))
  if (authorDate) lines.push(Text({ content: `Date:    ${authorDate}`, fg: theme.muted }))
  return Box({ flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 }, ...lines)
}

function inputField(label: string, value: string, active: boolean, cursor?: number) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: active ? theme.accent : theme.border, padding: 1, flexGrow: 1 },
    Text({ content: label, fg: active ? theme.accent : theme.muted }),
    Text({ content: editableText(value, active, cursor), fg: theme.text }),
  )
}

function compactDateField(label: string, value: string, active: boolean, cursor?: number) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: active ? theme.accent : theme.border, padding: 1, flexGrow: 1 },
    Text({ content: label, fg: active ? theme.accent : theme.muted }),
    Text({ content: editableText(value, active, cursor), fg: theme.text }),
  )
}

function formattedDateFromFlow(flow: RewriteDateState): string {
  return `${flow.dateYear}-${flow.dateMonth}-${flow.dateDay}T${flow.dateHour}:${flow.dateMinute}:${flow.dateSecond}${flow.timezone}`
}

function previewPanel(title: string, content: string, fg: string, limit: number) {
  const lines = content.split("\n").filter((l) => l.trim() !== "").slice(0, limit)
  return Box(
    { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: title, fg: theme.accent }),
    ...(lines.length === 0
      ? [Text({ content: "(empty)", fg: theme.muted })]
      : lines.map((line) => Text({ content: truncate(line, 80), fg }))),
  )
}

function warningsBox(warnings: string[]) {
  if (warnings.length === 0) return Box({ flexDirection: "column" })
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
    Text({ content: "Warnings:", fg: theme.danger }),
    ...warnings.map((w) => Text({ content: `  ${truncate(w, 90)}`, fg: theme.text })),
  )
}

function visualTodoLines(rows: VisualRebaseTodoRow[], selectedIndex: number) {
  if (rows.length === 0) return [Text({ content: "No commits in selected range", fg: theme.muted })]
  return rows.slice(0, 16).map((row, index) => {
    const prefix = index === selectedIndex ? ">" : " "
    const action = row.action.padEnd(6)
    return Text({ content: `${prefix} ${action} ${row.shortSha.padEnd(9)} ${truncate(row.subject, 44)}`, fg: index === selectedIndex ? theme.accent : theme.text })
  })
}

function selectedDetails(row: VisualRebaseTodoRow, activeField: "list" | "message" | "command") {
  return [
    Text({ content: `Subject: ${truncate(row.subject, 72)}`, fg: theme.text }),
    Text({ content: `Action:  ${row.action}`, fg: theme.text }),
    Text({ content: `Message: ${editableText(row.message ?? row.subject, activeField === "message", row.messageCursor, 72)}`, fg: activeField === "message" ? theme.accent : theme.muted }),
    Text({ content: `Command: ${editableText(row.command ?? "", activeField === "command", row.commandCursor, 72)}`, fg: activeField === "command" ? theme.accent : theme.muted }),
    Text({ content: "Notes: squash/fixup cannot be first; merge commits are blocked in v1.", fg: theme.muted }),
  ]
}

function splitPathLines(paths: string[], flow: SplitCommitState) {
  if (paths.length === 0) return [Text({ content: "Selected commit has no changed files", fg: theme.muted })]
  return paths.slice(0, 16).map((path, index) => {
    const selected = index === flow.selectedPathIndex
    const part = flow.pathAssignments[path] ?? 0
    return Text({ content: `${selected ? ">" : " "} part ${part + 1}  ${truncate(path, 62)}`, fg: selected ? theme.accent : theme.text })
  })
}

function splitPartSummary(paths: string[], flow: SplitCommitState) {
  return flow.parts.map((part, index) => {
    const count = paths.filter((path) => (flow.pathAssignments[path] ?? 0) === index).length
    const prefix = index === flow.selectedPartIndex ? ">" : " "
    const label = part.message.trim() || "(empty message)"
    return Text({ content: `${prefix} part ${index + 1}: ${count} file(s) - ${truncate(label, 44)}`, fg: index === flow.selectedPartIndex ? theme.accent : theme.muted })
  })
}

function historyEditRows(rows: HistoryEditDraft[], selectedIndex: number) {
  if (rows.length === 0) return [Text({ content: "No commits found", fg: theme.muted })]
  const start = visibleWindowStart(rows.length, selectedIndex, 15)
  return rows.slice(start, start + 15).map((row, visibleIndex) => {
    const index = start + visibleIndex
    const selected = index === selectedIndex
    return Text({ content: `${selected ? ">" : " "} ${String(index + 1).padStart(4)} ${row.shortSha.padEnd(9)} ${rowStatus(row).padEnd(14)} ${truncate(row.subject, 38)}`, fg: selected ? theme.accent : row.drop ? theme.danger : theme.text })
  })
}

function historyEditDetails(row: HistoryEditDraft, activeField: "list" | "message" | "date") {
  return [
    Text({ content: `Subject: ${truncate(row.subject, 74)}`, fg: theme.text }),
    Text({ content: `Message: ${editableText(row.message ?? row.subject, activeField === "message", row.messageCursor, 74)}`, fg: activeField === "message" ? theme.accent : theme.muted }),
    Text({ content: `Date:    ${editableText(row.date ?? row.authorDate, activeField === "date", row.dateCursor, 74)}`, fg: activeField === "date" ? theme.accent : theme.muted }),
    Text({ content: `Mode:    ${row.dateMode ?? "both"}`, fg: row.date ? theme.text : theme.muted }),
    Text({ content: `Status:  ${rowStatus(row)}`, fg: row.drop ? theme.danger : rowStatus(row) === "pick" ? theme.muted : theme.ok }),
  ]
}

function rowStatus(row: HistoryEditDraft): string {
  if (row.drop) return "drop"
  const statuses = []
  if (row.message !== undefined) statuses.push("reword")
  if (row.date !== undefined) statuses.push(`date:${row.dateMode ?? "both"}`)
  return statuses.length === 0 ? "pick" : statuses.join("+")
}

function visibleWindowStart(total: number, selectedIndex: number, limit: number): number {
  if (total <= limit) return 0
  return Math.min(Math.max(0, selectedIndex - Math.floor(limit / 2)), Math.max(0, total - limit))
}

function firstDropDescendants(rows: HistoryEditDraft[]): HistoryEditDraft[] {
  const oldestDrop = rows.reduce((oldest, row, index) => row.drop ? Math.max(oldest, index) : oldest, -1)
  return oldestDrop < 0 ? [] : rows.slice(0, oldestDrop)
}

function previewPaneContent(flow: HistoryListEditState): { title: string; content: string } {
  const p = flow.preview
  if (!p) return { title: "Preview", content: "" }
  if (flow.previewPane === "oldGraph") return { title: "Old Graph", content: p.oldGraph }
  if (flow.previewPane === "newGraph") return { title: "New Graph", content: p.newGraph }
  if (flow.previewPane === "metadata") return { title: "Metadata", content: `Before\n${p.oldMetadata}\n\nAfter\n${p.newMetadata}` }
  if (flow.previewPane === "todo") return { title: "Generated Rebase Todo", content: p.todo }
  return { title: "Final Diff", content: p.finalDiffPatch || p.finalDiffStat || "(no final tree diff)" }
}

function previewLineColor(line: string): string {
  if (line.startsWith("+")) return theme.ok
  if (line.startsWith("-")) return theme.danger
  if (line.startsWith("@@")) return theme.accent
  return theme.text
}

function oldToNewLines(oldToNew: Record<string, string>) {
  const entries = Object.entries(oldToNew)
  if (entries.length === 0) return [Text({ content: "Old-to-new mapping: (not discoverable for this plan)", fg: theme.muted })]
  return [
    Text({ content: "Old-to-new mapping:", fg: theme.accent }),
    ...entries.slice(0, 3).map(([oldSha, newSha]) => Text({ content: `  ${oldSha.slice(0, 10)} -> ${newSha.slice(0, 10)}`, fg: theme.muted })),
  ]
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function editableText(value: string, active: boolean, cursor = value.length, maxLength?: number): string {
  const index = Math.min(Math.max(0, cursor), value.length)
  const content = active ? `${value.slice(0, index)}|${value.slice(index)}` : value
  return maxLength ? truncate(content, maxLength) : content
}
