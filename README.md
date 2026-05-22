# Git Surgeon

Safe, visual Git history surgery from a terminal UI.

Built with Bun, TypeScript, and OpenTUI. Every destructive operation is previewed first, backed by a safety ref, and logged before anything touches your repository.

## Features

- Auto-detect local Git repositories
- Works over SSH and remote terminals
- Edit commit messages
- Change commit author name and email
- Edit commit date and time
- Delete commits from history
- Split commits into smaller commits
- Interactive visual rebase
- Edit multiple commits at once
- Repository size analysis
- Automatic backups before changes
- Preview diffs before applying changes
- Direct `.git` folder operations
- Simple terminal UI
- Recovery support for reverted changes

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
