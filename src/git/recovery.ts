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

export async function createRecoveryBranch(repoPath: string, backupRef: string, branchName?: string): Promise<string> {
  validateBackupRef(backupRef)
  const short = (await runGitChecked({ repoPath, args: ["rev-parse", "--short", backupRef] })).stdout.trim()
  const name = branchName ?? `gitsurgeon-recovery-${short}`
  await runGitChecked({ repoPath, args: ["branch", name, backupRef] })
  return name
}

export async function pushBackupToUpstream(repoPath: string, backupRef: string, upstream: string): Promise<string> {
  validateBackupRef(backupRef)
  const match = upstream.match(/^([^/]+)\/(.+)$/)
  if (!match) throw new Error(`Current branch has no pushable upstream: ${upstream}`)
  const [, remote, branch] = match
  const result = await runGitChecked({ repoPath, args: ["push", "-f", remote, `${backupRef}:refs/heads/${branch}`] })
  return (result.stdout || result.stderr).trim() || `Pushed ${backupRef} to ${upstream}`
}

export async function guardedResetBranchToBackup(repoPath: string, backupRef: string, confirmation: string): Promise<void> {
  validateBackupRef(backupRef)
  if (confirmation !== `reset to ${backupRef}`) throw new Error(`Confirmation must match: reset to ${backupRef}`)
  await runGitChecked({ repoPath, args: ["reset", "--hard", backupRef] })
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

function validateBackupRef(ref: string): void {
  if (!ref.startsWith("refs/gitsurgeon/backups/")) throw new Error(`Ref is not a Git Surgeon backup ref: ${ref}`)
}
