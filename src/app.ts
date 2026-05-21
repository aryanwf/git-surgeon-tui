import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { changeCommitAuthor, validateAuthorInput } from "./git/author"
import { getConflictReport, rebaseAbort, rebaseContinue, rebaseSkip } from "./git/conflict"
import { changeOldCommitDate } from "./git/date"
import { dropSingleCommit } from "./git/drop"
import { getCommitDiff, listCommits, searchCommits } from "./git/log"
import { buildHistoryPreview, withScratchClone } from "./git/preview"
import { visualInteractiveRebase, type VisualRebaseAction, type VisualRebaseRow } from "./git/rebase"
import { validateRepository } from "./git/repository"
import { getRecoveryReport } from "./git/recovery"
import { renameOldCommitMessages } from "./git/reword"
import { analyzeRepositorySize } from "./git/size-analyzer"
import { getSplitCommitDetails, splitSingleCommit, type SplitCommitPart } from "./git/split"
import { createInitialState, startAuthorFlow, startDateFlow, startDropFlow, startRewordFlow, startSplitFlow, startVisualRebaseFlow } from "./state/store"
import type { AppState, RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState, SplitCommitState, VisualRebaseState, VisualRebaseTodoRow } from "./state/types"
import { DashboardScreen } from "./tui/screens/dashboard"
import { HistoryScreen } from "./tui/screens/history"
import { PreviewScreen } from "./tui/screens/preview"
import { RepoPickerScreen } from "./tui/screens/repo-picker"
import { RecoveryScreen } from "./tui/screens/recovery"
import {
  ChangeAuthorFlowScreen,
  ChangeDateFlowScreen,
  DropCommitFlowScreen,
  RewordFlowScreen,
  SplitCommitFlowScreen,
  VisualRebaseFlowScreen,
} from "./tui/screens/rewrite-flow"
import { ConflictScreen } from "./tui/screens/conflict"
import { SizeAnalyzerScreen } from "./tui/screens/size-analyzer"

export type RunTuiOptions = {
  repoPath?: string
  recentRepos?: string[]
}

export async function runGitSurgeonTui(options: RunTuiOptions = {}): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  let state: AppState = createInitialState(options.repoPath)
  const pickerPaths = uniquePaths([options.repoPath, process.cwd(), ...(options.recentRepos ?? [])])

  const render = async () => {
    for (const child of renderer.root.getChildren()) child.destroyRecursively()
    if (state.repoPath && state.screen !== "repo-picker") {
      try {
        const repository = await validateRepository(state.repoPath)
        state = { ...state, repository, error: undefined }

        // If a rebase is in progress and user is not already on the conflict screen, redirect.
        if (repository.rebaseInProgress && state.screen !== "conflict") {
          state = { ...state, screen: "conflict" }
        }

        if (state.screen === "history") {
          const commits = await searchCommits(repository.repoPath, { query: state.historyQuery, limit: 50 })
          const selectedIndex = clamp(state.selectedCommitIndex, 0, Math.max(0, commits.length - 1))
          const diff = commits[selectedIndex] ? await getCommitDiff(repository.repoPath, commits[selectedIndex].sha) : ""
          state = { ...state, selectedCommitIndex: selectedIndex, lastSelectedCommit: commits[selectedIndex] }
          renderer.root.add(HistoryScreen(repository, commits, selectedIndex, state.historyQuery, diff))
        } else if (state.screen === "size-analyzer") {
          const result = await analyzeRepositorySize({ repoPath: repository.repoPath, limit: 20 })
          renderer.root.add(SizeAnalyzerScreen(repository, result))
        } else if (state.screen === "recovery") {
          const report = await getRecoveryReport(repository.repoPath)
          renderer.root.add(RecoveryScreen(repository, report))
        } else if (state.screen === "preview") {
          const preview = await withScratchClone(repository.repoPath, (scratch) => {
            return buildHistoryPreview({ repoPath: repository.repoPath, scratchPath: scratch.repoPath, range: "HEAD" })
          })
          renderer.root.add(PreviewScreen(repository, preview, 0))
        } else if (state.screen === "conflict") {
          const conflict = await getConflictReport(repository.repoPath)
          renderer.root.add(ConflictScreen(repository, conflict))
        } else if (state.screen === "rewrite-reword") {
          const flow = state.rewriteFlow as RewriteRewordState
          if (flow.step === "preview" && !flow.preview) {
            // Run scratch preview asynchronously.
            try {
              const result = await renameOldCommitMessages({
                repoPath: repository.repoPath,
                messages: [{ sha: flow.selectedSha, message: flow.newMessage }],
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, preview: result.preview, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "form", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await renameOldCommitMessages({
                repoPath: repository.repoPath,
                messages: [{ sha: flow.selectedSha, message: flow.newMessage }],
                apply: true,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          renderer.root.add(RewordFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-drop") {
          const flow = state.rewriteFlow as RewriteDropState
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await dropSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha })
              state = {
                ...state,
                rewriteFlow: { ...flow, preview: result.preview, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "confirm", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await dropSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, apply: true })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          renderer.root.add(DropCommitFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-author") {
          const flow = state.rewriteFlow as RewriteAuthorState
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await changeCommitAuthor({
                repoPath: repository.repoPath,
                sha: flow.selectedSha,
                name: flow.newName,
                email: flow.newEmail,
                mode: flow.mode,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, preview: result.preview, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "warning", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await changeCommitAuthor({
                repoPath: repository.repoPath,
                sha: flow.selectedSha,
                name: flow.newName,
                email: flow.newEmail,
                mode: flow.mode,
                apply: true,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          renderer.root.add(ChangeAuthorFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-date") {
          const flow = state.rewriteFlow as RewriteDateState
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await changeOldCommitDate({
                repoPath: repository.repoPath,
                sha: flow.selectedSha,
                date: flow.newDate,
                mode: flow.mode,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, preview: result.preview, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "form", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await changeOldCommitDate({
                repoPath: repository.repoPath,
                sha: flow.selectedSha,
                date: flow.newDate,
                mode: flow.mode,
                apply: true,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) },
              }
            }
            void render()
            return
          }
          renderer.root.add(ChangeDateFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-split") {
          const flow = state.rewriteFlow as SplitCommitState
          if (flow.step === "form" && !flow.changedPaths) {
            try {
              const details = await getSplitCommitDetails(repository.repoPath, flow.selectedSha)
              state = { ...state, rewriteFlow: initializeSplitFlowPaths(flow, details.changedPaths) }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await splitSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, parts: toSplitCommitParts(flow) })
              state = { ...state, rewriteFlow: { ...flow, preview: result.preview, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await splitSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, parts: toSplitCommitParts(flow), apply: true })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          renderer.root.add(SplitCommitFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-visual-rebase") {
          const flow = state.rewriteFlow as VisualRebaseState
          if (flow.step === "form" && !flow.rows) {
            try {
              const commits = await listCommits(repository.repoPath, `${flow.baseSha}..HEAD`)
              state = {
                ...state,
                rewriteFlow: {
                  ...flow,
                  rows: commits.map((commit) => ({
                    sha: commit.sha,
                    shortSha: commit.shortSha,
                    subject: commit.subject,
                    action: "pick",
                  })),
                  error: commits.length === 0 ? "Selected base has no commits after it" : undefined,
                },
              }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await visualInteractiveRebase({
                repoPath: repository.repoPath,
                base: flow.baseSha,
                rows: toVisualRebaseRows(flow),
              })
              state = { ...state, rewriteFlow: { ...flow, preview: result.preview, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await visualInteractiveRebase({
                repoPath: repository.repoPath,
                base: flow.baseSha,
                rows: toVisualRebaseRows(flow),
                apply: true,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, error: undefined },
              }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          renderer.root.add(VisualRebaseFlowScreen(repository, flow))
        } else {
          renderer.root.add(DashboardScreen(repository))
        }
      } catch (error) {
        state = { ...state, screen: "repo-picker", error: error instanceof Error ? error.message : String(error) }
        renderer.root.add(RepoPickerScreen(pickerPaths, selectRepo, state.error))
      }
    } else {
      renderer.root.add(RepoPickerScreen(pickerPaths, selectRepo, state.error))
    }
  }

  const selectRepo = (repoPath: string) => {
    state = { ...state, screen: "dashboard", repoPath }
    void render()
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // Global shortcuts
    if (key.name === "q" || key.name === "escape") {
      const rewrites = ["rewrite-reword", "rewrite-drop", "rewrite-author", "rewrite-date", "rewrite-split", "rewrite-visual-rebase"] as const
      if (rewrites.includes(state.screen as (typeof rewrites)[number])) {
        state = { ...state, screen: "history", rewriteFlow: undefined }
        void render()
        return
      }
      renderer.destroy()
      return
    }
    if (key.name === "r") { void render(); return }
    if (key.name === "b" && state.screen !== "repo-picker") {
      state = { ...state, screen: "dashboard", rewriteFlow: undefined }
      void render()
      return
    }

    // Dashboard
    if (state.screen === "dashboard") {
      if (key.name === "h") { state = { ...state, screen: "history", selectedCommitIndex: 0 }; void render() }
      if (key.name === "s") { state = { ...state, screen: "size-analyzer" }; void render() }
      if (key.name === "v") { state = { ...state, screen: "recovery" }; void render() }
      if (key.name === "p") { state = { ...state, screen: "preview" }; void render() }
      return
    }

    // History screen: navigation + rewrite triggers
    if (state.screen === "history") {
      const nextState = handleHistoryKey(state, key)
      if (nextState !== state) { state = nextState; void render() }
      return
    }

    // Conflict screen
    if (state.screen === "conflict") {
      handleConflictKey(key)
      return
    }

    // Rewrite flow screens
    if (state.screen === "rewrite-reword") { handleRewordKey(key); return }
    if (state.screen === "rewrite-drop") { handleDropKey(key); return }
    if (state.screen === "rewrite-author") { handleAuthorKey(key); return }
    if (state.screen === "rewrite-date") { handleDateKey(key); return }
    if (state.screen === "rewrite-split") { handleSplitKey(key); return }
    if (state.screen === "rewrite-visual-rebase") { handleVisualRebaseKey(key); return }
  })

  // Conflict handlers

  function handleConflictKey(key: KeyEvent) {
    if (!state.repoPath) return
    if (key.name === "c") {
      rebaseContinue(state.repoPath).then(() => render()).catch(() => render())
    }
    if (key.name === "s") {
      rebaseSkip(state.repoPath).then(() => render()).catch(() => render())
    }
    if (key.name === "a") {
      rebaseAbort(state.repoPath).then(() => {
        state = { ...state, screen: "dashboard" }
        return render()
      }).catch(() => render())
    }
  }

  // Reword handlers

  function handleRewordKey(key: KeyEvent) {
    const flow = state.rewriteFlow as RewriteRewordState
    if (!flow) return

    if (flow.step === "form") {
      if (key.name === "return") {
        if (flow.newMessage.trim() === "") return
        state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        state = { ...state, rewriteFlow: { ...flow, newMessage: flow.newMessage.slice(0, -1) } }
        void render()
        return
      }
      if (isTypableChar(key)) {
        state = { ...state, rewriteFlow: { ...flow, newMessage: `${flow.newMessage}${key.sequence}` } }
        void render()
        return
      }
    }

    if (flow.step === "preview" && flow.preview) {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
        void render()
      }
    }
  }

  // Drop handlers

  function handleDropKey(key: KeyEvent) {
    const flow = state.rewriteFlow as RewriteDropState
    if (!flow) return

    if (flow.step === "confirm") {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
        return
      }
    }

    if (flow.step === "preview" && flow.preview) {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
        void render()
      }
    }
  }

  // Author handlers

  function handleAuthorKey(key: KeyEvent) {
    const flow = state.rewriteFlow as RewriteAuthorState
    if (!flow) return

    if (flow.step === "form") {
      if (key.name === "return") {
        try {
          validateAuthorInput(flow.newName, flow.newEmail)
          state = { ...state, rewriteFlow: { ...flow, step: "warning", error: undefined } }
        } catch (err) {
          state = { ...state, rewriteFlow: { ...flow, error: err instanceof Error ? err.message : String(err) } }
        }
        void render()
        return
      }
      if (key.name === "tab") {
        const fields = ["name", "email"] as const
        const idx = fields.indexOf(flow.activeField as "name" | "email")
        const next = fields[(idx + 1) % fields.length]
        state = { ...state, rewriteFlow: { ...flow, activeField: next } }
        void render()
        return
      }
      if (key.name === "left") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.max(0, idx - 1)] } }
        void render()
        return
      }
      if (key.name === "right") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.min(modes.length - 1, idx + 1)] } }
        void render()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        if (flow.activeField === "name") {
          state = { ...state, rewriteFlow: { ...flow, newName: flow.newName.slice(0, -1) } }
        } else {
          state = { ...state, rewriteFlow: { ...flow, newEmail: flow.newEmail.slice(0, -1) } }
        }
        void render()
        return
      }
      if (isTypableChar(key)) {
        if (flow.activeField === "name") {
          state = { ...state, rewriteFlow: { ...flow, newName: `${flow.newName}${key.sequence}` } }
        } else {
          state = { ...state, rewriteFlow: { ...flow, newEmail: `${flow.newEmail}${key.sequence}` } }
        }
        void render()
        return
      }
    }

    if (flow.step === "warning") {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
      }
    }

    if (flow.step === "preview" && flow.preview) {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
        void render()
      }
    }
  }

  // Date handlers

  function handleDateKey(key: KeyEvent) {
    const flow = state.rewriteFlow as RewriteDateState
    if (!flow) return

    if (flow.step === "form") {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
        return
      }
      if (key.name === "left") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.max(0, idx - 1)] } }
        void render()
        return
      }
      if (key.name === "right") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.min(modes.length - 1, idx + 1)] } }
        void render()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        state = { ...state, rewriteFlow: { ...flow, newDate: flow.newDate.slice(0, -1) } }
        void render()
        return
      }
      if (isTypableChar(key)) {
        state = { ...state, rewriteFlow: { ...flow, newDate: `${flow.newDate}${key.sequence}` } }
        void render()
        return
      }
    }

    if (flow.step === "preview" && flow.preview) {
      if (key.name === "return") {
        state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
        void render()
      }
    }
  }

  // Split commit handlers

  function handleSplitKey(key: KeyEvent) {
    const flow = state.rewriteFlow as SplitCommitState
    if (!flow) return

    if (flow.step === "form") {
      const paths = flow.changedPaths ?? []
      if (key.name === "return") {
        const error = validateSplitFlow(flow)
        state = { ...state, rewriteFlow: error ? { ...flow, error } : { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
        return
      }
      if (flow.activeField === "message") {
        if (key.name === "tab" || key.name === "escape") {
          state = { ...state, rewriteFlow: { ...flow, activeField: "paths" } }
          void render()
          return
        }
        if (key.name === "backspace" || key.name === "delete") {
          state = { ...state, rewriteFlow: updateSelectedSplitPart(flow, (message) => message.slice(0, -1)) }
          void render()
          return
        }
        if (isTypableChar(key)) {
          state = { ...state, rewriteFlow: updateSelectedSplitPart(flow, (message) => `${message}${key.sequence}`) }
          void render()
          return
        }
      }
      if (key.name === "tab") {
        state = { ...state, rewriteFlow: { ...flow, activeField: "message" } }
        void render()
        return
      }
      if (key.name === "up" || key.name === "k") {
        state = { ...state, rewriteFlow: { ...flow, selectedPathIndex: Math.max(0, flow.selectedPathIndex - 1) } }
        void render()
        return
      }
      if (key.name === "down" || key.name === "j") {
        state = { ...state, rewriteFlow: { ...flow, selectedPathIndex: Math.min(Math.max(0, paths.length - 1), flow.selectedPathIndex + 1) } }
        void render()
        return
      }
      if (key.name === "left" || key.name === "right") {
        const selectedPath = paths[flow.selectedPathIndex]
        if (!selectedPath) return
        const direction = key.name === "left" ? -1 : 1
        const current = flow.pathAssignments[selectedPath] ?? 0
        const next = (current + direction + flow.parts.length) % flow.parts.length
        state = { ...state, rewriteFlow: { ...flow, pathAssignments: { ...flow.pathAssignments, [selectedPath]: next }, selectedPartIndex: next } }
        void render()
        return
      }
      if (key.sequence === "[" || key.sequence === "]") {
        const direction = key.sequence === "[" ? -1 : 1
        state = { ...state, rewriteFlow: { ...flow, selectedPartIndex: (flow.selectedPartIndex + direction + flow.parts.length) % flow.parts.length } }
        void render()
        return
      }
      if (key.sequence === "n") {
        state = { ...state, rewriteFlow: { ...flow, parts: [...flow.parts, { message: `${flow.selectedSubject} (part ${flow.parts.length + 1})` }], selectedPartIndex: flow.parts.length } }
        void render()
        return
      }
      if (key.sequence === "x" && flow.parts.length > 2) {
        state = { ...state, rewriteFlow: removeSelectedSplitPart(flow) }
        void render()
        return
      }
    }

    if (flow.step === "preview" && flow.preview && key.name === "return") {
      state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
      void render()
    }
  }

  // Visual rebase handlers

  function handleVisualRebaseKey(key: KeyEvent) {
    const flow = state.rewriteFlow as VisualRebaseState
    if (!flow) return

    if (flow.step === "form") {
      const rows = flow.rows ?? []
      if (key.name === "return" && rows.length > 0) {
        state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        void render()
        return
      }
      if (flow.activeField !== "list") {
        if (key.name === "escape") {
          state = { ...state, rewriteFlow: { ...flow, activeField: "list" } }
          void render()
          return
        }
        if (key.name === "backspace" || key.name === "delete") {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedVisualRow(flow, (row) => editVisualRowText(row, field, -1)) }
          void render()
          return
        }
        if (isTypableChar(key)) {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedVisualRow(flow, (row) => editVisualRowText(row, field, key.sequence)) }
          void render()
          return
        }
      }
      if (key.name === "up" || key.name === "k") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.max(0, flow.selectedRowIndex - 1) } }
        void render()
        return
      }
      if (key.name === "down" || key.name === "j") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.min(Math.max(0, rows.length - 1), flow.selectedRowIndex + 1) } }
        void render()
        return
      }
      if (key.name === "left" || key.name === "right" || key.sequence === "x") {
        const direction = key.name === "left" ? -1 : 1
        state = { ...state, rewriteFlow: updateSelectedVisualRow(flow, (row, index) => ({ ...row, action: nextVisualAction(row.action, direction, index) })) }
        void render()
        return
      }
      if (key.sequence === "[") {
        state = { ...state, rewriteFlow: moveVisualRow(flow, -1) }
        void render()
        return
      }
      if (key.sequence === "]") {
        state = { ...state, rewriteFlow: moveVisualRow(flow, 1) }
        void render()
        return
      }
      if (key.sequence === "e") {
        state = { ...state, rewriteFlow: updateSelectedVisualRow({ ...flow, activeField: "message" }, (row) => ({ ...row, message: row.message ?? row.subject })) }
        void render()
        return
      }
      if (key.sequence === "c") {
        state = { ...state, rewriteFlow: updateSelectedVisualRow({ ...flow, activeField: "command" }, (row) => ({ ...row, action: "exec", command: row.command ?? "" })) }
        void render()
        return
      }
    }

    if (flow.step === "preview" && flow.preview && key.name === "return") {
      state = { ...state, rewriteFlow: { ...flow, step: "applying" } }
      void render()
    }
  }

  await render()
}

function uniquePaths(paths: (string | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isTypableChar(key: KeyEvent): boolean {
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " " && key.name !== "q"
}

function handleHistoryKey(state: AppState, key: KeyEvent): AppState {
  if (key.name === "up" || key.name === "k") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 1) }
  }
  if (key.name === "down" || key.name === "j") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 1 }
  }
  if (key.name === "backspace" || key.name === "delete") {
    return { ...state, historyQuery: state.historyQuery.slice(0, -1), selectedCommitIndex: 0 }
  }

  if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " ") {
    // Rewrite flow triggers require a selected commit from last render.
    if (key.sequence === "w" && state.lastSelectedCommit) {
      return startRewordFlow(state, state.lastSelectedCommit)
    }
    if (key.sequence === "d" && state.lastSelectedCommit) {
      return startDropFlow(state, state.lastSelectedCommit)
    }
    if (key.sequence === "a" && state.lastSelectedCommit) {
      return startAuthorFlow(state, state.lastSelectedCommit)
    }
    if (key.sequence === "t" && state.lastSelectedCommit) {
      return startDateFlow(state, state.lastSelectedCommit)
    }
    if (key.sequence === "s" && state.lastSelectedCommit) {
      return startSplitFlow(state, state.lastSelectedCommit)
    }
    if (key.sequence === "i" && state.lastSelectedCommit) {
      return startVisualRebaseFlow(state, state.lastSelectedCommit)
    }
    // Otherwise append to search filter, excluding shortcut keys.
    if (key.sequence !== "q" && key.sequence !== "w" && key.sequence !== "d" && key.sequence !== "a" && key.sequence !== "t" && key.sequence !== "s" && key.sequence !== "i") {
      return { ...state, historyQuery: `${state.historyQuery}${key.sequence}`, selectedCommitIndex: 0 }
    }
  }
  return state
}

function initializeSplitFlowPaths(flow: SplitCommitState, changedPaths: string[]): SplitCommitState {
  const pathAssignments = Object.fromEntries(changedPaths.map((path, index) => [path, index === 0 ? 0 : 1]))
  return {
    ...flow,
    changedPaths,
    pathAssignments,
    selectedPathIndex: 0,
    selectedPartIndex: 0,
    error: changedPaths.length < 2 ? "File-level split needs at least two changed paths" : undefined,
  }
}

function toSplitCommitParts(flow: SplitCommitState): SplitCommitPart[] {
  const paths = flow.changedPaths ?? []
  return flow.parts.map((part, index) => ({
    message: part.message,
    paths: paths.filter((path) => (flow.pathAssignments[path] ?? 0) === index),
  }))
}

function validateSplitFlow(flow: SplitCommitState): string | undefined {
  const parts = toSplitCommitParts(flow)
  if (!flow.changedPaths || flow.changedPaths.length < 2) return "File-level split needs at least two changed paths"
  if (parts.length < 2) return "Split requires at least two commit parts"
  const emptyPart = parts.findIndex((part) => part.paths.length === 0)
  if (emptyPart >= 0) return `Part ${emptyPart + 1} must include at least one path`
  const emptyMessage = parts.findIndex((part) => part.message.trim() === "")
  if (emptyMessage >= 0) return `Part ${emptyMessage + 1} needs a commit message`
  return undefined
}

function updateSelectedSplitPart(flow: SplitCommitState, update: (message: string) => string): SplitCommitState {
  return {
    ...flow,
    parts: flow.parts.map((part, index) => index === flow.selectedPartIndex ? { ...part, message: update(part.message) } : part),
  }
}

function removeSelectedSplitPart(flow: SplitCommitState): SplitCommitState {
  const removed = flow.selectedPartIndex
  const parts = flow.parts.filter((_, index) => index !== removed)
  const pathAssignments = Object.fromEntries(Object.entries(flow.pathAssignments).map(([path, partIndex]) => {
    if (partIndex === removed) return [path, Math.max(0, removed - 1)]
    return [path, partIndex > removed ? partIndex - 1 : partIndex]
  }))
  return {
    ...flow,
    parts,
    pathAssignments,
    selectedPartIndex: Math.min(removed, parts.length - 1),
  }
}

function toVisualRebaseRows(flow: VisualRebaseState): VisualRebaseRow[] {
  return (flow.rows ?? []).map((row) => ({
    sha: row.sha,
    action: row.action,
    message: row.message,
    command: row.command,
  }))
}

function updateSelectedVisualRow(flow: VisualRebaseState, update: (row: VisualRebaseTodoRow, index: number) => VisualRebaseTodoRow): VisualRebaseState {
  const rows = flow.rows ?? []
  if (rows.length === 0) return flow
  return {
    ...flow,
    rows: rows.map((row, index) => index === flow.selectedRowIndex ? update(row, index) : row),
  }
}

function editVisualRowText(row: VisualRebaseTodoRow, field: "message" | "command", value: string | -1): VisualRebaseTodoRow {
  const current = field === "message" ? row.message ?? row.subject : row.command ?? ""
  const next = value === -1 ? current.slice(0, -1) : `${current}${value}`
  return field === "message" ? { ...row, message: next } : { ...row, command: next }
}

function moveVisualRow(flow: VisualRebaseState, direction: -1 | 1): VisualRebaseState {
  const rows = [...(flow.rows ?? [])]
  const from = flow.selectedRowIndex
  const to = from + direction
  if (from < 0 || to < 0 || from >= rows.length || to >= rows.length) return flow
  const [row] = rows.splice(from, 1)
  rows.splice(to, 0, row)
  return { ...flow, rows, selectedRowIndex: to }
}

function nextVisualAction(action: VisualRebaseAction, direction: number, index: number): VisualRebaseAction {
  const actions: VisualRebaseAction[] = index === 0
    ? ["pick", "reword", "edit", "drop", "exec"]
    : ["pick", "reword", "edit", "squash", "fixup", "drop", "exec"]
  const current = Math.max(0, actions.indexOf(action))
  return actions[(current + direction + actions.length) % actions.length]
}
