import { Box, Text } from "@opentui/core"
import type { BackupApplyPreview, RecoveryReport } from "../../git/recovery"
import type { RepositoryState } from "../../git/repository"
import { KeyHelp } from "../components/key-help"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function RecoveryScreen(state: RepositoryState, report: RecoveryReport, selectedBackupIndex: number, applyPreview?: BackupApplyPreview, exportResult?: { path?: string; error?: string }) {
  const selectedBackup = report.backups[selectedBackupIndex]
  const previewMatchesSelection = applyPreview?.backupRef === selectedBackup?.refName
  return AppFrame(
    "Recovery Viewer",
    Box(
      { flexDirection: "column", gap: 1, flexGrow: 1 },
      section("Reflog", report.reflog.slice(0, 10).map((entry) => `${entry.selector.padEnd(12)} ${entry.sha.slice(0, 10)} ${truncate(entry.subject, 74)}`)),
      section("Backup refs", report.backups.slice(0, 8).map((ref, index) => `${index === selectedBackupIndex ? ">" : " "} ${ref.sha.slice(0, 10)} ${truncate(ref.refName, 86)}`)),
      ...(previewMatchesSelection ? [applyPreviewSection(applyPreview)] : []),
      section("Dangling objects", report.dangling.slice(0, 10).map((object) => `${object.objectType.padEnd(6)} ${object.sha.slice(0, 10)} ${truncate(object.subject ?? formatSize(object.size), 74)}`)),
      ...(exportResult?.path ? [Text({ content: `Result: ${exportResult.path}`, fg: theme.ok })] : []),
      ...(exportResult?.error ? [Text({ content: `Error: ${exportResult.error}`, fg: theme.danger })] : []),
      ...(selectedBackup ? [Text({ content: `Selected backup: ${selectedBackup.refName}`, fg: theme.muted })] : []),
    ),
    KeyHelp([
      ["↑/↓", "select backup"],
      ["c", "create branch"],
      ["enter", previewMatchesSelection ? "apply previewed backup" : "preview remote apply"],
      ["e", "export latest report"],
      ["b / esc", "back to dashboard"],
    ]),
    StatusBar(state),
  )
}

function applyPreviewSection(preview: BackupApplyPreview) {
  return Box(
    { flexDirection: "row", gap: 1 },
    previewPanel(`Before ${preview.upstream}`, `${preview.beforeHead.slice(0, 12)}\n${preview.beforeLog}`, theme.danger),
    previewPanel(`After ${preview.backupRef}`, `${preview.afterHead.slice(0, 12)}\n${preview.afterLog}\n\nDiff stat:\n${preview.diffStat}`, theme.ok),
  )
}

function previewPanel(title: string, content: string, fg: string) {
  const lines = content.split("\n").filter((line) => line.trim() !== "").slice(0, 12)
  return Box(
    { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
    Text({ content: title, fg: theme.accent }),
    ...lines.map((line) => Text({ content: truncate(line, 72), fg })),
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
