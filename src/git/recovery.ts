import { runGit, runGitChecked } from "./runner"

export type ReflogEntry = {
  sha: string
  selector: string
  subject: string
  authorName: string
  authorEmail: string
  date: string
}

export type BackupRef = {
  refName: string
  sha: string
  subject: string
  date: string
}

export type DanglingObject = {
  objectType: "commit" | "tree" | "blob" | "tag" | string
  sha: string
  subject?: string
  size?: number
}

export type RecoveryReport = {
  reflog: ReflogEntry[]
  backups: BackupRef[]
  dangling: DanglingObject[]
}

export async function getRecoveryReport(repoPath: string): Promise<RecoveryReport> {
  const [reflog, backups, dangling] = await Promise.all([
    listReflog(repoPath, 30),
    listBackupRefs(repoPath),
    scanDanglingObjects(repoPath),
  ])

  return { reflog, backups, dangling }
}

export async function listReflog(repoPath: string, limit = 30): Promise<ReflogEntry[]> {
  const format = "%H%x00%gd%x00%gs%x00%an%x00%ae%x00%aI%x1e"
  const result = await runGitChecked({ repoPath, args: ["log", "-g", `-${limit}`, `--format=${format}`] })
  return parseReflog(result.stdout)
}

export async function listBackupRefs(repoPath: string): Promise<BackupRef[]> {
  const format = "%(refname)%00%(objectname)%00%(creatordate:iso-strict)%00%(subject)%1e"
  const result = await runGit({ repoPath, args: ["for-each-ref", "refs/gitsurgeon/backups", `--format=${format}`] })
  if (result.exitCode !== 0) return []
  return parseBackupRefs(result.stdout)
}

export async function scanDanglingObjects(repoPath: string): Promise<DanglingObject[]> {
  const result = await runGit({ repoPath, args: ["fsck", "--full", "--no-reflogs"] })
  if (result.exitCode !== 0 && result.stdout.trim() === "" && result.stderr.trim() === "") return []
  const objects = parseDanglingObjects(`${result.stdout}\n${result.stderr}`)

  return Promise.all(objects.map(async (object) => {
    if (object.objectType === "commit") {
      const subject = await runGit({ repoPath, args: ["show", "-s", "--format=%s", object.sha] })
      return subject.exitCode === 0 ? { ...object, subject: subject.stdout.trim() } : object
    }
    if (object.objectType === "blob") {
      const size = await runGit({ repoPath, args: ["cat-file", "-s", object.sha] })
      const parsed = Number(size.stdout.trim())
      return size.exitCode === 0 && Number.isFinite(parsed) ? { ...object, size: parsed } : object
    }
    return object
  }))
}

export function parseReflog(output: string): ReflogEntry[] {
  return output
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, selector, subject, authorName, authorEmail, date] = row.split("\x00")
      return { sha, selector, subject, authorName, authorEmail, date }
    })
}

export function parseBackupRefs(output: string): BackupRef[] {
  return output
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [refName, sha, date, subject] = row.split("\x00")
      return { refName, sha, date, subject }
    })
}

export function parseDanglingObjects(output: string): DanglingObject[] {
  const objects = new Map<string, DanglingObject>()
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(?:dangling|unreachable)\s+(commit|tree|blob|tag)\s+([0-9a-f]{40})$/)
    if (!match) continue
    objects.set(match[2], { objectType: match[1], sha: match[2] })
  }
  return Array.from(objects.values())
}
