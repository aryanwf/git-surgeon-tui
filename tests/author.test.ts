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

async function commitField(repoPath: string, ref: string, format: string): Promise<string> {
  return (await runGitChecked({ repoPath, args: ["show", "-s", `--format=${format}`, ref] })).stdout.trim()
}
