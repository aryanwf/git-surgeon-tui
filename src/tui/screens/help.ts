import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import { KeyHelp } from "../components/key-help"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function HelpScreen(state?: RepositoryState) {
  return AppFrame(
    "Help",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      section("Navigation", [
        "?: help    b: dashboard    r: refresh    esc: back, exit prompt on dashboard",
        "Dashboard: h history, p preview, s size analysis, v recovery",
        "History: j/k select, type to filter, backspace deletes filter text",
      ]),
      section("Rewrite Flows", [
        "w: rename commit    d: drop commit    s: split commit    a: author    t: date    i: visual rebase",
        "Every destructive flow runs a scratch preview before applying to the real repository.",
        "Applied rewrites create refs/gitsurgeon/backups/... and an operation JSON log.",
      ]),
      section("Recovery And Reports", [
        "Recovery is read-only by default and shows reflog, backup refs, and dangling objects.",
        "Press e on the recovery screen to export the latest operation report as Markdown.",
        "Config is stored at $XDG_CONFIG_HOME/gitsurgeon/config.json or ~/.config/gitsurgeon/config.json.",
      ]),
    ),
    KeyHelp([
      ["b / esc", "back to dashboard"],
    ]),
    StatusBar(state),
  )
}

function section(title: string, rows: string[]) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: title, fg: theme.accent }),
    ...rows.map((row) => Text({ content: row, fg: theme.text })),
  )
}
