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

export type CommitLogOptions = {
  range?: string
  query?: string
  limit?: number
  newestFirst?: boolean
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

export async function searchCommits(repoPath: string, options: CommitLogOptions = {}): Promise<CommitSummary[]> {
  const commits = await listCommits(repoPath, options.range ?? "HEAD")
  const query = options.query?.trim().toLowerCase()
  const ordered = options.newestFirst === false ? commits : [...commits].reverse()
  const filtered = query
    ? ordered.filter((commit) => commitMatchesQuery(commit, query))
    : ordered

  return options.limit === undefined ? filtered : filtered.slice(0, options.limit)
}

export async function getCommitDiff(repoPath: string, sha: string): Promise<string> {
  const result = await runGitChecked({
    repoPath,
    args: ["show", "--format=medium", "--stat", "--patch", "--find-renames", "--no-ext-diff", "--no-color", sha],
  })
  return result.stdout
}

export async function getCommitParents(repoPath: string, sha: string): Promise<string[]> {
  const result = await runGitChecked({ repoPath, args: ["rev-list", "--parents", "-n", "1", sha] })
  return result.stdout.trim().split(" ").slice(1).filter(Boolean)
}

export async function getHeadCommits(repoPath: string): Promise<CommitSummary[]> {
  return listCommits(repoPath, "HEAD")
}

function commitMatchesQuery(commit: CommitSummary, query: string): boolean {
  return [
    commit.sha,
    commit.shortSha,
    commit.authorName,
    commit.authorEmail,
    commit.authorDate,
    commit.subject,
    commit.refs.join(" "),
  ].some((value) => value.toLowerCase().includes(query))
}
