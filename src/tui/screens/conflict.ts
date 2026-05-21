import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export type ConflictState = {
  conflictedFiles: string[]
  rebaseStep?: string
  rebaseTotal?: string
  rebaseHead?: string
}

export function ConflictScreen(state: RepositoryState, conflict: ConflictState) {
  return AppFrame(
    "Rebase Conflict",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.danger, padding: 1 },
        Text({ content: "A rebase operation has stopped with conflicts.", fg: theme.danger }),
        ...(conflict.rebaseStep && conflict.rebaseTotal
          ? [Text({ content: `Step ${conflict.rebaseStep} of ${conflict.rebaseTotal}`, fg: theme.muted })]
          : []),
        ...(conflict.rebaseHead ? [Text({ content: `Conflicting commit: ${conflict.rebaseHead}`, fg: theme.muted })] : []),
      ),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "Conflicted files:", fg: theme.accent }),
        ...(conflict.conflictedFiles.length === 0
          ? [Text({ content: "  (none detected — check git status manually)", fg: theme.muted })]
          : conflict.conflictedFiles.map((f) => Text({ content: `  ${f}`, fg: theme.danger }))),
      ),
      Box(
        { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
        Text({ content: "Manual resolution steps:", fg: theme.accent }),
        Text({ content: "  1. Edit each conflicted file and resolve the conflict markers.", fg: theme.text }),
        Text({ content: "  2. Stage the resolved files: git add <file>", fg: theme.text }),
        Text({ content: "  3. Press c to continue, s to skip, or a to abort.", fg: theme.text }),
      ),
      recoveryCommandsBox(state),
    ),
    Text({ content: "c: git rebase --continue  s: git rebase --skip  a: git rebase --abort  b/esc: dashboard", fg: theme.muted }),
    StatusBar(state),
  )
}

function recoveryCommandsBox(state: RepositoryState) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: "Recovery commands (run in terminal):", fg: theme.accent }),
    Text({ content: `  git -C ${state.repoPath} rebase --continue`, fg: theme.muted }),
    Text({ content: `  git -C ${state.repoPath} rebase --skip`, fg: theme.muted }),
    Text({ content: `  git -C ${state.repoPath} rebase --abort`, fg: theme.muted }),
  )
}
