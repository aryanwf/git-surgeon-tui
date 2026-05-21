import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import type { RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState, SplitCommitState, VisualRebaseState, VisualRebaseTodoRow } from "../../state/types"
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
        Text({ content: `${flow.newMessage}|`, fg: theme.text }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    Text({ content: "type: edit message  backspace: delete  enter: preview  escape: cancel", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Rename Commit Message — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit message renamed successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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
  const descendants = p?.descendants ?? []
  return AppFrame(
    "Drop Commit",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: "Commit to be dropped:", fg: theme.danger }),
        Text({ content: `  ${flow.selectedSha.slice(0, 10)}  ${flow.selectedSubject}`, fg: theme.text }),
      ),
      descendants.length > 0
        ? Box(
            { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
            Text({ content: `${descendants.length} descendant commit(s) will be rewritten:`, fg: theme.accent }),
            ...descendants.slice(0, 8).map((c) => Text({ content: `  ${c.shortSha.padEnd(10)} ${truncate(c.subject, 64)}`, fg: theme.muted })),
          )
        : Text({ content: "No descendant commits.", fg: theme.muted }),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    Text({ content: "enter: preview drop  escape: cancel", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Drop Commit — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit dropped successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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
  const modeHelp = `left/right: change (current: ${flow.mode})`

  return AppFrame(
    "Change Commit Author",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      commitInfoBox(flow.selectedSha, flow.selectedSubject, flow.selectedAuthorName, flow.selectedAuthorEmail),
      Box(
        { flexDirection: "row", gap: 1 },
        inputField("Name", flow.newName, flow.activeField === "name"),
        inputField("Email", flow.newEmail, flow.activeField === "email"),
      ),
      Box(
        { flexDirection: "row", gap: 1 },
        Text({ content: `Mode: `, fg: theme.muted }),
        ...modes.map((m, i) =>
          Text({ content: ` ${m} `, fg: i === modeIndex ? theme.accent : theme.muted }),
        ),
        Text({ content: `  (left/right to change)`, fg: theme.muted }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    Text({ content: "tab: next field  left/right: change mode  enter: next  escape: cancel", fg: theme.muted }),
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
    Text({ content: "enter: proceed to preview  escape: cancel", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Change Commit Author — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Author metadata changed successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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
      inputField("New date (ISO 8601 with timezone)", flow.newDate, flow.activeField === "date"),
      Box(
        { flexDirection: "row", gap: 1 },
        Text({ content: "Mode: ", fg: theme.muted }),
        ...modes.map((m, i) =>
          Text({ content: ` ${m} `, fg: i === modeIndex ? theme.accent : theme.muted }),
        ),
        Text({ content: "  (left/right to change)", fg: theme.muted }),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    Text({ content: "type: edit date  left/right: change mode  enter: preview  escape: cancel", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Change Commit Date — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit date changed successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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
          Text({ content: `${selectedPart?.message ?? ""}${flow.activeField === "message" ? "|" : ""}`, fg: theme.text }),
          Text({ content: "", fg: theme.muted }),
          ...splitPartSummary(paths, flow),
          ...(selectedPath ? [Text({ content: `Selected file goes to part ${(flow.pathAssignments[selectedPath] ?? 0) + 1}`, fg: theme.muted })] : []),
        ),
      ),
      ...(flow.error ? [Text({ content: `Error: ${flow.error}`, fg: theme.danger })] : []),
    ),
    Text({ content: "j/k: file  left/right: assign part  tab: edit message  [/]: part  n: add part  x: remove part  enter: preview", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Split Commit — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Commit split successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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
    Text({ content: "j/k: select  left/right/x: action  [/]: reorder  e: edit msg  c: exec cmd  enter: preview", fg: theme.muted }),
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
    Text({ content: "enter: apply to real repo  escape: cancel", fg: theme.muted }),
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
      Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
      StatusBar(state),
    )
  }
  return AppFrame(
    "Visual Interactive Rebase — Applied",
    Box(
      { flexDirection: "column", gap: 1 },
      Text({ content: "Visual interactive rebase applied successfully.", fg: theme.ok }),
      ...(flow.backupRef ? [Text({ content: `Backup ref: ${flow.backupRef}`, fg: theme.text })] : []),
      ...(flow.operationLogPath ? [Text({ content: `Operation log: ${flow.operationLogPath}`, fg: theme.muted })] : []),
    ),
    Text({ content: "escape: back to history  b: dashboard", fg: theme.muted }),
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

function inputField(label: string, value: string, active: boolean) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: active ? theme.accent : theme.border, padding: 1, flexGrow: 1 },
    Text({ content: label, fg: active ? theme.accent : theme.muted }),
    Text({ content: `${value}${active ? "|" : ""}`, fg: theme.text }),
  )
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
    Text({ content: `Message: ${truncate(row.message ?? row.subject, 72)}${activeField === "message" ? "|" : ""}`, fg: activeField === "message" ? theme.accent : theme.muted }),
    Text({ content: `Command: ${truncate(row.command ?? "", 72)}${activeField === "command" ? "|" : ""}`, fg: activeField === "command" ? theme.accent : theme.muted }),
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

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}
