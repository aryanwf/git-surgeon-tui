import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function DashboardScreen(state: RepositoryState) {
  const rows = dashboardRows(state)
  const commands = [
    ["h", "History and diff"],
    ["p", "Preview rewrite impact"],
    ["s", "Size analysis"],
    ["v", "Recovery viewer"],
    ["?", "Help"],
  ] as const

  return AppFrame(
    "Git Surgeon",
    Box(
      { flexDirection: "column", gap: 1 },
      ...rows.map(([label, value]) => Text({ content: `${label.padEnd(14)} ${value}`, fg: theme.text })),
      Box(
        { flexDirection: "column", gap: 0, marginTop: 1 },
        Text({ content: "Commands available", fg: theme.accent }),
        ...commands.map(([key, label]) => Text({ content: `${key.padEnd(3)} ${label}`, fg: theme.muted })),
      ),
    ),
    Text({ content: "q: quit  r: refresh", fg: theme.muted }),
    StatusBar(state),
  )
}

export function dashboardRows(state: RepositoryState): [string, string][] {
  return [
    ["Repository", state.repoPath],
    ["Branch", state.branch],
    ["HEAD", state.head.slice(0, 12)],
    ["Dirty", state.dirty ? "yes" : "no"],
    ["Upstream", state.upstream ?? "(none)"],
    ["Git dir", state.gitDir],
    ["Common dir", state.gitCommonDir],
    ["Status", state.operationStatus],
  ]
}
