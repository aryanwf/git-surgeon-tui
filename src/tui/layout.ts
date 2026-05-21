import { Box, Text, type VChild } from "@opentui/core"

export const theme = {
  background: "#101417",
  panel: "#172026",
  border: "#49616f",
  accent: "#e3b341",
  text: "#e8edf0",
  muted: "#8fa1aa",
  danger: "#ff6b6b",
  ok: "#78d09f",
}

export function AppFrame(title: string, ...children: VChild[]) {
  return Box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: theme.background,
      padding: 1,
      gap: 1,
    },
    Text({ content: title, fg: theme.accent }),
    Box(
      {
        flexGrow: 1,
        borderStyle: "rounded",
        borderColor: theme.border,
        backgroundColor: theme.panel,
        padding: 1,
        gap: 1,
      },
      ...children,
    ),
  )
}
