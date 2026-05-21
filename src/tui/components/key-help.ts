import { Box, Text } from "@opentui/core"
import { theme } from "../layout"

export function KeyHelp(keys: [string, string][]) {
  return Box(
    { flexDirection: "column", gap: 0 },
    ...keys.map(([key, label]) => Text({ content: `${key.padEnd(10)} ${label}`, fg: theme.muted })),
  )
}
