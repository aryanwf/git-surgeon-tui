import { Box, Text } from "@opentui/core"
import type { CommitSummary } from "../../git/log"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function HistoryScreen(state: RepositoryState, commits: CommitSummary[], selectedIndex: number, query: string, diff: string) {
  const selected = commits[selectedIndex]
  return AppFrame(
    "History And Diff",
    Text({ content: `Filter: ${query || "(type to search)"}`, fg: theme.muted }),
    Box(
      { flexDirection: "row", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", width: "42%", borderStyle: "single", borderColor: theme.border, padding: 1 },
        ...formatCommitRows(commits, selectedIndex).map((line) => Text({ content: line.content, fg: line.selected ? theme.accent : theme.text })),
      ),
      Box(
        { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: selected ? `${selected.shortSha} ${selected.subject}` : "No commit selected", fg: theme.accent }),
        ...previewLines(diff, 24).map((line) => Text({ content: line, fg: lineColor(line) })),
      ),
    ),
    Text({ content: "j/k: select  type: filter  w: reword  d: drop  s: split  a: author  t: date  i: rebase  b: dashboard", fg: theme.muted }),
    StatusBar(state),
  )
}

export function formatCommitRows(commits: CommitSummary[], selectedIndex: number): { content: string; selected: boolean }[] {
  if (commits.length === 0) return [{ content: "No commits match the current filter", selected: false }]
  return commits.slice(0, 18).map((commit, index) => ({
    content: `${index === selectedIndex ? ">" : " "} ${commit.shortSha.padEnd(9)} ${commit.authorDate.slice(0, 10)} ${truncate(commit.subject, 48)}`,
    selected: index === selectedIndex,
  }))
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
