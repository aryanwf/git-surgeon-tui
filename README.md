# Git Surgeon

Safe, visual Git history surgery from a terminal UI.

Built with Bun, TypeScript, and OpenTUI. Every destructive operation is previewed first, backed by a safety ref, and logged before anything touches your repository.

## Features

- Interactive TUI for browsing history and planning rewrites
- Reword commit messages anywhere in history
- Change author and committer dates on any commit
- Drop a single commit cleanly
- Split a commit into multiple commits by path
- Visual interactive rebase (pick, reword, edit, squash, fixup, drop, exec)
- Repository size analyzer (native or `git filter-repo`)
- Operation reports exported to disk
- Automatic backup refs and operation logs for every rewrite
- Preview-by-default: nothing is applied without `--apply`
- Scriptable CLI for every TUI action

## Install

```bash
bun install
```

Optionally compile a standalone binary:

```bash
bun run build:bin
# -> ./dist/gitsurgeon tui
```

## Usage

Launch the TUI:

```bash
bun src/index.ts tui
```

Run directly from GitHub without cloning:

```bash
bunx github:aryanwf/git-surgeon-tui tui --repo .
```

Or use the CLI directly. Every command previews by default; add `--apply` to write.

### Reword

```bash
bun src/index.ts rename --repo <path> \
  --message <sha>=<new message> \
  [--message <sha>=<new message>] [--apply]
```

### Drop

```bash
bun src/index.ts drop --repo <path> --sha <commit> [--apply]
```

### Split

```bash
bun src/index.ts split --repo <path> --sha <commit> \
  --part "<message>:path/a,path/b" \
  --part "<message>:path/c" [--apply]
```

### Rebase

```bash
bun src/index.ts rebase --repo <path> --base <commit> \
  --row <action>:<sha>[:<message-or-command>] [--row ...] [--apply]
```

Actions: `pick`, `reword`, `edit`, `squash`, `fixup`, `drop`, `exec`.

### Date

```bash
bun src/index.ts date --repo <path> --sha <commit> \
  --date <iso-8601> --mode <author|committer|both> [--apply]
```

### Size

```bash
bun src/index.ts size --repo <path> \
  [--method <native|filter-repo>] \
  [--sort <unpacked|packed>] \
  [--status <all|present|deleted>] \
  [--limit <n>]
```

### Report

```bash
bun src/index.ts report --repo <path> [--output <path>]
```

## Config

Recent repositories and preferences are stored at
`$XDG_CONFIG_HOME/gitsurgeon/config.json` (defaults to `~/.config/gitsurgeon/config.json`).

## Development

```bash
bun run typecheck
bun test
```

## License

MIT
