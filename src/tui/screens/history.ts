import { Box, Text } from "@opentui/core"
import type { CommitSummary } from "../../git/log"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function HistoryScreen(state: RepositoryState, commits: CommitSummary[], selectedIndex: number, scrollOffset: number, query: string, queryCursor: number, diff: string) {
  const selected = commits[selectedIndex]
  const visibleLimit = 18
  const visibleStart = visibleWindowStart(commits.length, selectedIndex, scrollOffset, visibleLimit)
  const visibleEnd = Math.min(commits.length, visibleStart + visibleLimit)
  return AppFrame(
    "History And Diff",
    Text({ content: `Filter: ${query ? editableText(query, queryCursor) : "|(type to search)"}   ${commits.length} commit(s)   showing ${commits.length === 0 ? 0 : visibleStart + 1}-${visibleEnd}`, fg: theme.muted }),
    Box(
      { flexDirection: "row", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", width: "42%", borderStyle: "single", borderColor: theme.border, padding: 1 },
        ...formatCommitRows(commits, selectedIndex, visibleStart, visibleLimit).map((line) => Text({ content: line.content, fg: line.selected ? theme.accent : theme.text })),
      ),
      Box(
        { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: selected ? `${selected.shortSha} ${selected.subject}` : "No commit selected", fg: theme.accent }),
        ...previewLines(diff, 24).map((line) => Text({ content: line, fg: lineColor(line) })),
      ),
    ),
    Text({ content: "j/k: select  left/right: filter cursor  type: filter  m/w/d/a/t/s/i: actions  b/esc: dashboard", fg: theme.muted }),
    StatusBar(state),
  )
}

export function formatCommitRows(commits: CommitSummary[], selectedIndex: number, scrollOffset = 0, limit = 18): { content: string; selected: boolean }[] {
  if (commits.length === 0) return [{ content: "No commits match the current filter", selected: false }]
  const start = visibleWindowStart(commits.length, selectedIndex, scrollOffset, limit)
  return commits.slice(start, start + limit).map((commit, visibleIndex) => {
    const index = start + visibleIndex
    return {
    content: `${index === selectedIndex ? ">" : " "} ${String(index + 1).padStart(4)} ${commit.shortSha.padEnd(9)} ${commit.authorDate.slice(0, 10)} ${truncate(commit.subject, 43)}`,
    selected: index === selectedIndex,
    }
  })
}

export function visibleWindowStart(total: number, selectedIndex: number, scrollOffset: number, limit: number): number {
  if (total <= limit) return 0
  if (selectedIndex < scrollOffset) return selectedIndex
  if (selectedIndex >= scrollOffset + limit) return selectedIndex - limit + 1
  return Math.min(Math.max(0, scrollOffset), Math.max(0, total - limit))
}

function previewLines(value: string, limit: number): string[] {
  const lines = value.split("\n").filter((line) => line.trim() !== "")
  return lines.length === 0 ? ["(empty diff)"] : lines.slice(0, limit).map((line) => truncate(line, 96))
}

function lineColor(line: string): string {
  if (line.startsWith("+")) return theme.ok
  if (line.startsWith("-")) return theme.danger
  if (line.startsWith("@@")) return theme.accent
  return theme.text
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function editableText(value: string, cursor: number): string {
  const index = Math.min(Math.max(0, cursor), value.length)
  return `${value.slice(0, index)}|${value.slice(index)}`
}
