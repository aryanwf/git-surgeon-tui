import { Box, Text } from "@opentui/core"
import type { RecoveryReport } from "../../git/recovery"
import type { RepositoryState } from "../../git/repository"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function RecoveryScreen(state: RepositoryState, report: RecoveryReport, exportResult?: { path?: string; error?: string }) {
  const newestBackup = report.backups[0]
  return AppFrame(
    "Recovery Viewer",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      section("Reflog", report.reflog.slice(0, 10).map((entry) => `${entry.selector.padEnd(12)} ${entry.sha.slice(0, 10)} ${truncate(entry.subject, 74)}`)),
      section("Backup refs", report.backups.slice(0, 8).map((ref) => `${ref.sha.slice(0, 10)} ${truncate(ref.refName, 88)}`)),
      section("Dangling objects", report.dangling.slice(0, 10).map((object) => `${object.objectType.padEnd(6)} ${object.sha.slice(0, 10)} ${truncate(object.subject ?? formatSize(object.size), 74)}`)),
      ...(exportResult?.path ? [Text({ content: `Exported report: ${exportResult.path}`, fg: theme.ok })] : []),
      ...(exportResult?.error ? [Text({ content: `Export failed: ${exportResult.error}`, fg: theme.danger })] : []),
      ...(newestBackup ? [Text({ content: `Newest backup action target: ${newestBackup.refName}`, fg: theme.muted })] : []),
    ),
    Text({ content: "c: create recovery branch from newest backup  e: export latest operation report  b: dashboard", fg: theme.muted }),
    StatusBar(state),
  )
}

function section(title: string, rows: string[]) {
  return Box(
    { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: title, fg: theme.accent }),
    ...(rows.length === 0 ? [Text({ content: "(none)", fg: theme.muted })] : rows.map((row) => Text({ content: row, fg: theme.text }))),
  )
}

function formatSize(size?: number): string {
  if (size === undefined) return ""
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(1)} KiB`
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}
