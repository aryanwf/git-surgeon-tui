import { Box, Text } from "@opentui/core"
import type { RepositoryState } from "../../git/repository"
import type { SizeAnalyzerResult } from "../../git/size-analyzer"
import { KeyHelp } from "../components/key-help"
import { StatusBar } from "../components/status-bar"
import { AppFrame, theme } from "../layout"

export function SizeAnalyzerScreen(state: RepositoryState, result: SizeAnalyzerResult) {
  return AppFrame(
    "Size Analyzer",
    Text({ content: `Method: ${result.method}  Sort: ${result.sortBy}  Status: ${result.status}`, fg: theme.muted }),
    Box(
      { flexDirection: "column", borderStyle: "single", borderColor: theme.border, padding: 1, flexGrow: 1 },
      Text({ content: "Unpacked   Packed     Status    Object       Path(s)", fg: theme.accent }),
      ...result.rows.map((row) => Text({
        content: `${formatSize(row.unpackedSize).padEnd(10)} ${formatSize(row.packedSize).padEnd(10)} ${row.status.padEnd(9)} ${(row.objectId || "-").slice(0, 10).padEnd(10)} ${truncate(row.paths.join(", ") || "(unknown)", 72)}`,
        fg: row.status === "deleted" ? theme.danger : theme.text,
      })),
    ),
    Text({ content: "Native read-only fallback is shown. CLI size command also supports --method filter-repo.", fg: theme.muted }),
    KeyHelp([
      ["r", "refresh analysis"],
      ["b / esc", "back to dashboard"],
    ]),
    StatusBar(state),
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}
