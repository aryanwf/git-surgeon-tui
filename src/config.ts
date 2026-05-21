import { mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type GitSurgeonPreferences = {
  defaultSizeLimit: number
}

export type GitSurgeonConfig = {
  recentRepos: string[]
  preferences: GitSurgeonPreferences
}

const defaultConfig: GitSurgeonConfig = {
  recentRepos: [],
  preferences: {
    defaultSizeLimit: 20,
  },
}

export function getConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || (process.env.HOME ? join(process.env.HOME, ".config") : process.cwd())
  return join(base, "gitsurgeon", "config.json")
}

export async function loadGitSurgeonConfig(path = getConfigPath()): Promise<GitSurgeonConfig> {
  try {
    const raw = await readFile(path, "utf8")
    return parseGitSurgeonConfig(JSON.parse(raw))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return defaultConfig
    throw error
  }
}

export async function saveGitSurgeonConfig(config: GitSurgeonConfig, path = getConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(parseGitSurgeonConfig(config), null, 2)}\n`)
}

export async function rememberRecentRepo(repoPath: string, path = getConfigPath()): Promise<GitSurgeonConfig> {
  const config = await loadGitSurgeonConfig(path)
  const recentRepos = [repoPath, ...config.recentRepos.filter((entry) => entry !== repoPath)].slice(0, 10)
  const next = { ...config, recentRepos }
  await saveGitSurgeonConfig(next, path)
  return next
}

export function parseGitSurgeonConfig(value: unknown): GitSurgeonConfig {
  if (!value || typeof value !== "object") return defaultConfig
  const input = value as Partial<GitSurgeonConfig>
  const recentRepos = Array.isArray(input.recentRepos) ? input.recentRepos.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
  const defaultSizeLimit = input.preferences?.defaultSizeLimit
  return {
    recentRepos: [...new Set(recentRepos)].slice(0, 10),
    preferences: {
      defaultSizeLimit: typeof defaultSizeLimit === "number" && Number.isInteger(defaultSizeLimit) && defaultSizeLimit > 0 ? defaultSizeLimit : defaultConfig.preferences.defaultSizeLimit,
    },
  }
}
