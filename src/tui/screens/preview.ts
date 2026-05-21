import { Box, Text } from "@opentui/core"
import { renderHistoryPreview, type HistoryPreview } from "../../git/preview"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function PreviewScreen(state: RepositoryState, preview: HistoryPreview, changedCommitCount?: number, droppedCommitIds: string[] = []) {
  const rendered = renderHistoryPreview(preview, { changedCommitCount, droppedCommitIds })
  return AppFrame(
    "History Preview",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "row", gap: 1 },
        panel("Summary", rendered.summary, theme.text, 6),
        panel("Final Diff Stat", rendered.finalDiffStat, theme.text, 6),
      ),
      Box(
        { flexDirection: "row", gap: 1, flexGrow: 1 },
        panel("Before", rendered.oldGraph, theme.danger, 18),
        panel("After", rendered.newGraph, theme.ok, 18),
      ),
      panel("Final Diff", rendered.finalDiffPatch, theme.text, 12),
    ),
    Text({ content: "Preview runs in a scratch clone. Apply actions remain disabled until a scratch run succeeds.", fg: theme.muted }),
    StatusBar(state),
  )
}

function panel(title: string, lines: string[], fg: string, limit: number) {
  return Box(
    { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: title, fg: theme.accent }),
    ...lines.slice(0, limit).map((line) => Text({ content: truncate(line, 96), fg: lineColor(line, fg) })),
  )
}

function lineColor(line: string, fallback: string): string {
  if (line.startsWith("+")) return theme.ok
  if (line.startsWith("-")) return theme.danger
  if (line.startsWith("@@")) return theme.accent
  return fallback
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}
