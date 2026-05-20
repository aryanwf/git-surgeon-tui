import { runGitChecked } from "./runner"

export type CommitSummary = {
  sha: string
  shortSha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: string
  committerName: string
  committerEmail: string
  committerDate: string
  subject: string
  refs: string[]
}

export async function listCommits(repoPath: string, range = "HEAD"): Promise<CommitSummary[]> {
  const format = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%s%x1e"
  const result = await runGitChecked({ repoPath, args: ["log", "--reverse", `--format=${format}`, range] })
  return result.stdout
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, shortSha, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, refs, subject] = row.split("\x00")
      return {
        sha,
        shortSha,
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        subject,
        refs: refs ? refs.split(", ").filter(Boolean) : [],
      }
    })
}

export async function getCommitParents(repoPath: string, sha: string): Promise<string[]> {
  const result = await runGitChecked({ repoPath, args: ["rev-list", "--parents", "-n", "1", sha] })
  return result.stdout.trim().split(" ").slice(1).filter(Boolean)
}

export async function getHeadCommits(repoPath: string): Promise<CommitSummary[]> {
  return listCommits(repoPath, "HEAD")
}
