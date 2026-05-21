import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import { theme } from "../layout"

export function StatusBar(state?: RepositoryState) {
  const status = state ? formatOperationStatus(state) : "No repository selected"
  const color = state?.operationStatus === "ready" ? theme.ok : state ? theme.danger : theme.muted

  return Box(
    {
      height: 1,
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    Text({ content: status, fg: color }),
    Text({ content: "?: help  b: dashboard  r: refresh  esc: back/exit prompt", fg: theme.muted }),
  )
}

export function formatOperationStatus(state: RepositoryState): string {
  if (state.operationStatus === "operation-in-progress") return "Operation in progress - recovery only"
  if (state.operationStatus === "dirty") return "Dirty worktree - rewrites blocked"
  return "Ready for safe operations"
}
