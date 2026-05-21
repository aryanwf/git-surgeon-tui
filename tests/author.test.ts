import { expect, test } from "bun:test"
import { changeCommitAuthor } from "../src/git/author"
import { runGitChecked } from "../src/git/runner"
import { commitSubjects, createFixtureRepo } from "./fixtures"

test("previews changing a commit author in a scratch clone", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()

  const result = await changeCommitAuthor({
    repoPath,
    sha: commits[1],
    name: "New Author",
    email: "new@example.com",
    mode: "both",
  })

  expect(result.applied).toBe(false)
  expect(result.preview.oldHead).toBe(oldHead)
  expect(result.preview.newHead).not.toBe(oldHead)
  expect(result.preview.newLog).toContain("New Author <new@example.com>")
  expect(result.preview.newLog).toContain("New Author <new@example.com>")
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("applies author-only change while preserving committer", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldHead = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD"] })).stdout.trim()
  const oldCommitter = await commitField(repoPath, commits[1], "%cn <%ce>")

  const result = await changeCommitAuthor({
    repoPath,
    sha: commits[1],
    name: "Changed Author",
    email: "changed@example.com",
    mode: "author",
    apply: true,
  })

  expect(result.applied).toBe(true)
  expect(result.backupRef).toStartWith("refs/gitsurgeon/backups/")
  expect(result.operationLogPath).toBeString()
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])

  const newAuthor = await commitField(repoPath, "HEAD~1", "%an <%ae>")
  const newCommitter = await commitField(repoPath, "HEAD~1", "%cn <%ce>")
  expect(newAuthor).toBe("Changed Author <changed@example.com>")
  expect(newCommitter).toBe(oldCommitter)

  const backupHead = (await runGitChecked({ repoPath, args: ["rev-parse", result.backupRef!] })).stdout.trim()
  expect(backupHead).toBe(oldHead)
})

test("applies committer-only change while preserving author", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  const oldAuthor = await commitField(repoPath, commits[1], "%an <%ae>")

  await changeCommitAuthor({
    repoPath,
    sha: commits[1],
    name: "New Committer",
    email: "committer@example.com",
    mode: "committer",
    apply: true,
  })

  const newAuthor = await commitField(repoPath, "HEAD~1", "%an <%ae>")
  const newCommitter = await commitField(repoPath, "HEAD~1", "%cn <%ce>")
  expect(newAuthor).toBe(oldAuthor)
  expect(newCommitter).toBe("New Committer <committer@example.com>")
})

test("applies both author and committer change", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await changeCommitAuthor({
    repoPath,
    sha: commits[1],
    name: "Full Change",
    email: "full@example.com",
    mode: "both",
    apply: true,
  })

  const newAuthor = await commitField(repoPath, "HEAD~1", "%an <%ae>")
  const newCommitter = await commitField(repoPath, "HEAD~1", "%cn <%ce>")
  expect(newAuthor).toBe("Full Change <full@example.com>")
  expect(newCommitter).toBe("Full Change <full@example.com>")
})

test("changes the root commit author with --root rebase", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await changeCommitAuthor({
    repoPath,
    sha: commits[0],
    name: "Root Changer",
    email: "root@example.com",
    mode: "author",
    apply: true,
  })

  const newAuthor = await commitField(repoPath, "HEAD~2", "%an <%ae>")
  expect(newAuthor).toBe("Root Changer <root@example.com>")
  expect(await commitSubjects(repoPath)).toEqual(["first commit", "second commit", "third commit"])
})

test("blocks empty author name", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await expect(changeCommitAuthor({ repoPath, sha: commits[1], name: "", email: "test@example.com", mode: "both" })).rejects.toThrow("empty")
})

test("blocks invalid email", async () => {
  const { repoPath, commits } = await createFixtureRepo()

  await expect(changeCommitAuthor({ repoPath, sha: commits[1], name: "Name", email: "not-an-email", mode: "both" })).rejects.toThrow("@")
})

test("blocks dirty worktrees before changing author", async () => {
  const { repoPath, commits } = await createFixtureRepo()
  await Bun.write(`${repoPath}/dirty.txt`, "dirty\n")

  await expect(changeCommitAuthor({ repoPath, sha: commits[1], name: "New", email: "new@example.com", mode: "both", apply: true })).rejects.toThrow("dirty")
})

test("preserves committer identity and dates on downstream commits made by other people", async () => {
  const { repoPath } = await createFixtureRepo({ commitCount: 1 })

  // Build the rest of the history with different authors and committers, and
  // distinct committer dates that must survive the rewrite.
  const otherCommits: Array<{ file: string; message: string; author: string; authorEmail: string; committer: string; committerEmail: string; authorDate: string; committerDate: string }> = [
    {
      file: "alice.txt",
      message: "alice work",
      author: "Alice",
      authorEmail: "alice@example.com",
      committer: "Alice",
      committerEmail: "alice@example.com",
      authorDate: "2026-05-21T09:00:00Z",
      committerDate: "2026-05-21T09:30:00Z",
    },
    {
      file: "bob.txt",
      message: "bob work",
      author: "Bob",
      authorEmail: "bob@example.com",
      committer: "Bob",
      committerEmail: "bob@example.com",
      authorDate: "2026-05-22T11:00:00Z",
      committerDate: "2026-05-22T11:45:00Z",
    },
  ]

  for (const c of otherCommits) {
    await Bun.write(`${repoPath}/${c.file}`, `${c.message}\n`)
    await runGitChecked({ repoPath, args: ["add", c.file] })
    await runGitChecked({
      repoPath,
      args: ["commit", "-m", c.message],
      env: {
        GIT_AUTHOR_NAME: c.author,
        GIT_AUTHOR_EMAIL: c.authorEmail,
        GIT_AUTHOR_DATE: c.authorDate,
        GIT_COMMITTER_NAME: c.committer,
        GIT_COMMITTER_EMAIL: c.committerEmail,
        GIT_COMMITTER_DATE: c.committerDate,
      },
    })
  }

  const rootSha = (await runGitChecked({ repoPath, args: ["rev-parse", "HEAD~2"] })).stdout.trim()

  await changeCommitAuthor({
    repoPath,
    sha: rootSha,
    name: "Renamed Root",
    email: "renamed@example.com",
    mode: "both",
    apply: true,
  })

  // Root rewrite: author + committer changed as requested.
  expect(await commitField(repoPath, "HEAD~2", "%an <%ae>")).toBe("Renamed Root <renamed@example.com>")
  expect(await commitField(repoPath, "HEAD~2", "%cn <%ce>")).toBe("Renamed Root <renamed@example.com>")

  // Downstream commits: original author, committer AND committer date intact.
  expect(await commitField(repoPath, "HEAD~1", "%an <%ae>")).toBe(`${otherCommits[0].author} <${otherCommits[0].authorEmail}>`)
  expect(await commitField(repoPath, "HEAD~1", "%cn <%ce>")).toBe(`${otherCommits[0].committer} <${otherCommits[0].committerEmail}>`)
  expect(await commitField(repoPath, "HEAD~1", "%aI")).toBe(otherCommits[0].authorDate)
  expect(await commitField(repoPath, "HEAD~1", "%cI")).toBe(otherCommits[0].committerDate)

  expect(await commitField(repoPath, "HEAD", "%an <%ae>")).toBe(`${otherCommits[1].author} <${otherCommits[1].authorEmail}>`)
  expect(await commitField(repoPath, "HEAD", "%cn <%ce>")).toBe(`${otherCommits[1].committer} <${otherCommits[1].committerEmail}>`)
  expect(await commitField(repoPath, "HEAD", "%aI")).toBe(otherCommits[1].authorDate)
  expect(await commitField(repoPath, "HEAD", "%cI")).toBe(otherCommits[1].committerDate)
})

async function commitField(repoPath: string, ref: string, format: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", `--format=${format}`, ref] })).stdout.trim()
}
