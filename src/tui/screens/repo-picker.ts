import { Box, Select, SelectRenderableEvents, Text, type SelectOption } from "@opentui/core"
import { AppFrame, theme } from "../layout"

export type RepoPickerOption = SelectOption & { value: string }

export function buildRepoPickerOptions(paths: string[]): RepoPickerOption[] {
  return paths.map((path) => ({
    name: path,
    description: "Open and validate this Git repository",
    value: path,
  }))
}

export function RepoPickerScreen(paths: string[], onSelect: (repoPath: string) => void, error?: string) {
  const picker = Select({
    height: Math.max(4, Math.min(paths.length + 2, 10)),
    width: "100%",
    options: buildRepoPickerOptions(paths),
    showDescription: true,
    wrapSelection: true,
    selectedBackgroundColor: "#35424a",
    selectedTextColor: theme.accent,
    descriptionColor: theme.muted,
  })

  picker.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: RepoPickerOption) => onSelect(option.value))
  picker.focus()

  return AppFrame(
    "Select Repository",
    Text({ content: "Choose a repository to validate. Pass --repo <path> to skip this screen.", fg: theme.muted }),
    Box({ borderStyle: "single", borderColor: theme.border, padding: 1 }, picker),
    Text({ content: error ?? "", fg: theme.danger }),
  )
}
