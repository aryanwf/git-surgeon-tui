import { Box, Text, type SelectOption } from "@opentui/core"
import { KeyHelp } from "../components/key-help"
import { AppFrame, theme } from "../layout"

export type RepoPickerOption = SelectOption & { value: string }

export function buildRepoPickerOptions(paths: string[]): RepoPickerOption[] {
  return paths.map((path) => ({
    name: path,
    description: "Open and validate this Git repository",
    value: path,
  }))
}

export function RepoPickerScreen(paths: string[], query: string, queryCursor: number, selectedIndex: number, error?: string) {
  const start = visibleWindowStart(paths.length, selectedIndex, 10)
  const visible = buildRepoPickerOptions(paths).slice(start, start + 10)

  return AppFrame(
    "Select Repository",
    Text({ content: "Search repositories by path or folder name. Pass --repo <path> to skip this screen.", fg: theme.muted }),
    Text({ content: `Search: ${query ? editableText(query, queryCursor) : "|(type to filter)"}`, fg: theme.accent }),
    Box(
      { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
      ...(visible.length > 0
        ? visible.map((option, index) => {
          const absoluteIndex = start + index
          return Text({ content: `${absoluteIndex === selectedIndex ? ">" : " "} ${option.name}`, fg: absoluteIndex === selectedIndex ? theme.accent : theme.text })
        })
        : [Text({ content: "No repositories match the current search", fg: theme.muted })]),
    ),
    KeyHelp([
      ["type", "search repositories"],
      ["↑/↓", "select repository"],
      ["←/→", "move search cursor"],
      ["backspace", "edit search"],
      ["enter", "open repository"],
      ["esc", "show exit prompt"],
    ]),
    Text({ content: error ?? "", fg: theme.danger }),
  )
}

function editableText(value: string, cursor: number): string {
  const index = Math.min(Math.max(0, cursor), value.length)
  return `${value.slice(0, index)}|${value.slice(index)}`
}

function visibleWindowStart(total: number, selectedIndex: number, limit: number): number {
  if (total <= limit) return 0
  if (selectedIndex < 0) return 0
  if (selectedIndex >= total) return Math.max(0, total - limit)
  return Math.min(Math.max(0, selectedIndex - limit + 1), Math.max(0, total - limit))
}
