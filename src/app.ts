import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { loadGitSurgeonConfig, rememberRecentRepo } from "./config"
import { changeCommitAuthor, validateAuthorInput } from "./git/author"
import { getConflictReport, rebaseAbort, rebaseContinue, rebaseSkip } from "./git/conflict"
import { changeOldCommitDate } from "./git/date"
import { dropSingleCommit } from "./git/drop"
import { editCommitHistory, type HistoryEditOperation } from "./git/history-plan"
import { getCommitDiff, listCommits, searchCommits } from "./git/log"
import { buildHistoryPreview, withScratchClone } from "./git/preview"
import { visualInteractiveRebase, type VisualRebaseAction, type VisualRebaseRow } from "./git/rebase"
import { validateRepository } from "./git/repository"
import { exportLatestOperationReport } from "./git/report"
import { createRecoveryBranch, getRecoveryReport } from "./git/recovery"
import { renameOldCommitMessages } from "./git/reword"
import { runGitChecked } from "./git/runner"
import { analyzeRepositorySize } from "./git/size-analyzer"
import { getSplitCommitDetails, splitSingleCommit, type SplitCommitPart } from "./git/split"
import { createInitialState, startAuthorFlow, startDateFlow, startDropFlow, startHistoryListEditFlow, startRewordFlow, startSplitFlow, startVisualRebaseFlow } from "./state/store"
import type { AppState, HistoryEditDraft, HistoryListEditState, RewriteAuthorState, RewriteDateState, RewriteDropState, RewriteRewordState, SplitCommitState, VisualRebaseState, VisualRebaseTodoRow } from "./state/types"
import { DashboardScreen } from "./tui/screens/dashboard"
import { HistoryScreen } from "./tui/screens/history"
import { HelpScreen } from "./tui/screens/help"
import { PreviewScreen } from "./tui/screens/preview"
import { RepoPickerScreen } from "./tui/screens/repo-picker"
import { RecoveryScreen } from "./tui/screens/recovery"
import {
  ChangeAuthorFlowScreen,
  ChangeDateFlowScreen,
  DropCommitFlowScreen,
  HistoryListEditFlowScreen,
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
  const config = await loadGitSurgeonConfig()
  let state: AppState = createInitialState(options.repoPath)
  const pickerPaths = uniquePaths([options.repoPath, process.cwd(), ...(options.recentRepos ?? []), ...config.recentRepos])
  if (options.repoPath) void rememberRecentRepo(options.repoPath).catch(() => {})

  const render = async () => {
    const mount = (screen: Parameters<typeof renderer.root.add>[0]) => {
      for (const child of renderer.root.getChildren()) child.destroyRecursively()
      renderer.root.add(screen)
    }
    if (state.repoPath && state.screen !== "repo-picker") {
      try {
        const repository = await validateRepository(state.repoPath)
        state = { ...state, repository, error: undefined }

        // If a rebase is in progress and user is not already on the conflict screen, redirect.
        if (repository.rebaseInProgress && state.screen !== "conflict") {
          state = { ...state, screen: "conflict" }
        }

        if (state.screen === "history") {
          const commits = await searchCommits(repository.repoPath, { query: state.historyQuery })
          const selectedIndex = clamp(state.selectedCommitIndex, 0, Math.max(0, commits.length - 1))
          const scrollOffset = visibleWindowStart(commits.length, selectedIndex, state.historyScrollOffset, 18)
          const diff = commits[selectedIndex] ? await getCommitDiff(repository.repoPath, commits[selectedIndex].sha) : ""
          state = { ...state, selectedCommitIndex: selectedIndex, historyScrollOffset: scrollOffset, lastSelectedCommit: commits[selectedIndex] }
          mount(HistoryScreen(repository, commits, selectedIndex, scrollOffset, state.historyQuery, diff))
        } else if (state.screen === "size-analyzer") {
          const result = await analyzeRepositorySize({ repoPath: repository.repoPath, limit: 20 })
          mount(SizeAnalyzerScreen(repository, result))
        } else if (state.screen === "recovery") {
          const report = await getRecoveryReport(repository.repoPath)
          mount(RecoveryScreen(repository, report, { path: state.exportReportPath, error: state.exportReportError }))
        } else if (state.screen === "help") {
          mount(HelpScreen(repository))
        } else if (state.screen === "preview") {
          const preview = await withScratchClone(repository.repoPath, (scratch) => {
            return buildHistoryPreview({ repoPath: repository.repoPath, scratchPath: scratch.repoPath, range: "HEAD" })
          })
          mount(PreviewScreen(repository, preview, 0))
        } else if (state.screen === "conflict") {
          const conflict = await getConflictReport(repository.repoPath)
          mount(ConflictScreen(repository, conflict))
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
          mount(RewordFlowScreen(repository, flow))
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
          mount(DropCommitFlowScreen(repository, flow))
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
          mount(ChangeAuthorFlowScreen(repository, flow))
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
          mount(ChangeDateFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-history-list") {
          const flow = state.rewriteFlow as HistoryListEditState
          if (flow.step === "form" && !flow.rows) {
            const commits = await searchCommits(repository.repoPath, { query: state.historyQuery })
            state = { ...state, rewriteFlow: { ...flow, rows: commits.map(toHistoryEditDraft), selectedRowIndex: clamp(flow.selectedRowIndex, 0, Math.max(0, commits.length - 1)) } }
            void render()
            return
          }
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await editCommitHistory({ repoPath: repository.repoPath, operations: toHistoryEditOperations(flow) })
              state = { ...state, rewriteFlow: { ...flow, preview: result.preview, operationLogPath: result.operationLogPath, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await editCommitHistory({ repoPath: repository.repoPath, operations: toHistoryEditOperations(flow), apply: true })
              const pushOutput = repository.upstream ? await pushForceWithLease(repository.repoPath) : undefined
              state = { ...state, rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: err instanceof Error ? err.message : String(err) } }
            }
            void render()
            return
          }
          mount(HistoryListEditFlowScreen(repository, flow))
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
          mount(SplitCommitFlowScreen(repository, flow))
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
                    action: "pick" as const,
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
          mount(VisualRebaseFlowScreen(repository, flow))
        } else {
          mount(DashboardScreen(repository))
        }
      } catch (error) {
        state = { ...state, screen: "repo-picker", error: error instanceof Error ? error.message : String(error) }
        mount(RepoPickerScreen(pickerPaths, selectRepo, state.error))
      }
    } else {
      if (state.screen === "help") mount(HelpScreen())
      else mount(RepoPickerScreen(pickerPaths, selectRepo, state.error))
    }
  }

  const selectRepo = (repoPath: string) => {
    state = { ...state, screen: "dashboard", repoPath, exportReportPath: undefined, exportReportError: undefined }
    void rememberRecentRepo(repoPath).catch(() => {})
    void render()
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // Global shortcuts
    if (key.name === "q") {
      renderer.destroy()
      return
    }
    if (key.name === "escape") {
      if (state.screen === "help") {
        state = { ...state, screen: state.repoPath ? "dashboard" : "repo-picker" }
        void render()
        return
      }
      const rewrites = ["rewrite-reword", "rewrite-drop", "rewrite-author", "rewrite-date", "rewrite-history-list", "rewrite-split", "rewrite-visual-rebase"] as const
      if (rewrites.includes(state.screen as (typeof rewrites)[number])) {
        state = { ...state, screen: "history", rewriteFlow: undefined }
        void render()
        return
      }
      renderer.destroy()
      return
    }
    if (key.name === "r") { void render(); return }
    if (key.sequence === "?") {
      state = { ...state, screen: "help" }
      void render()
      return
    }
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

    if (state.screen === "recovery") {
      handleRecoveryKey(key)
      return
    }

    // Rewrite flow screens
    if (state.screen === "rewrite-reword") { handleRewordKey(key); return }
    if (state.screen === "rewrite-drop") { handleDropKey(key); return }
    if (state.screen === "rewrite-author") { handleAuthorKey(key); return }
    if (state.screen === "rewrite-date") { handleDateKey(key); return }
    if (state.screen === "rewrite-history-list") { handleHistoryListEditKey(key); return }
    if (state.screen === "rewrite-split") { handleSplitKey(key); return }
    if (state.screen === "rewrite-visual-rebase") { handleVisualRebaseKey(key); return }
  })

  // Conflict handlers

  function handleRecoveryKey(key: KeyEvent) {
    if (!state.repoPath) return
    if (key.sequence === "e") {
      exportLatestOperationReport({ repoPath: state.repoPath }).then((result) => {
        state = { ...state, exportReportPath: result.outputPath, exportReportError: undefined }
        return render()
      }).catch((error) => {
        state = { ...state, exportReportPath: undefined, exportReportError: error instanceof Error ? error.message : String(error) }
        return render()
      })
      return
    }
    if (key.sequence === "c") {
      getRecoveryReport(state.repoPath).then((report) => {
        const backup = report.backups[0]
        if (!backup) throw new Error("No Git Surgeon backup refs found")
        return createRecoveryBranch(state.repoPath!, backup.refName)
      }).then((branch) => {
        state = { ...state, exportReportPath: `Created recovery branch: ${branch}`, exportReportError: undefined }
        return render()
      }).catch((error) => {
        state = { ...state, exportReportPath: undefined, exportReportError: error instanceof Error ? error.message : String(error) }
        return render()
      })
    }
  }

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

  // List-based history edit handlers

  function handleHistoryListEditKey(key: KeyEvent) {
    const flow = state.rewriteFlow as HistoryListEditState
    if (!flow) return

    if (flow.step === "dirty") {
      if (key.sequence === "s" && state.repoPath) {
        runGitChecked({ repoPath: state.repoPath, args: ["stash", "push", "-u", "-m", "gitsurgeon auto-stash before history edit"] }).then((result) => {
          state = { ...state, rewriteFlow: { ...flow, step: "preview", stashedRef: result.stdout.trim() || "stash@{0}", preview: undefined, error: undefined } }
          return render()
        }).catch((err) => {
          state = { ...state, rewriteFlow: { ...flow, error: err instanceof Error ? err.message : String(err) } }
          return render()
        })
        return
      }
      if (key.sequence === "m" || key.sequence === "c") {
        state = { ...state, screen: "history", rewriteFlow: undefined }
        void render()
      }
      return
    }

    if (flow.step === "form") {
      const rows = flow.rows ?? []
      if (flow.activeField !== "list") {
        if (key.name === "escape" || key.name === "tab") {
          state = { ...state, rewriteFlow: { ...flow, activeField: "list" } }
          void render()
          return
        }
        if (key.name === "left" || key.name === "right") {
          const modes = ["author", "committer", "both"] as const
          const selected = rows[flow.selectedRowIndex]
          if (!selected || flow.activeField !== "date") return
          const idx = modes.indexOf(selected.dateMode ?? "both")
          const next = modes[clamp(idx + (key.name === "left" ? -1 : 1), 0, modes.length - 1)]
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => ({ ...row, dateMode: next })) }
          void render()
          return
        }
        if (key.name === "backspace" || key.name === "delete") {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => editHistoryRowText(row, field, -1)) }
          void render()
          return
        }
        if (isTypableChar(key)) {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => editHistoryRowText(row, field, key.sequence)) }
          void render()
          return
        }
      }
      if (key.name === "return") {
        const operations = toHistoryEditOperations(flow)
        if (operations.length === 0) {
          state = { ...state, rewriteFlow: { ...flow, error: "Mark at least one commit for reword, drop, or date edit" } }
        } else if (state.repository?.dirty) {
          state = { ...state, rewriteFlow: { ...flow, step: "dirty", error: undefined } }
        } else {
          state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined, previewScrollOffset: 0 } }
        }
        void render()
        return
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
      if (key.name === "pageup") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.max(0, flow.selectedRowIndex - 15) } }
        void render()
        return
      }
      if (key.name === "pagedown") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.min(Math.max(0, rows.length - 1), flow.selectedRowIndex + 15) } }
        void render()
        return
      }
      if (key.sequence === "x") {
        state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => ({ ...row, drop: !row.drop, message: undefined, date: undefined })) }
        void render()
        return
      }
      if (key.sequence === "w") {
        state = { ...state, rewriteFlow: updateSelectedHistoryEditRow({ ...flow, activeField: "message" }, (row) => ({ ...row, drop: false, message: row.message ?? row.subject })) }
        void render()
        return
      }
      if (key.sequence === "t") {
        state = { ...state, rewriteFlow: updateSelectedHistoryEditRow({ ...flow, activeField: "date" }, (row) => ({ ...row, drop: false, date: row.date ?? row.authorDate, dateMode: row.dateMode ?? "both" })) }
        void render()
        return
      }
      if (key.sequence === "c") {
        state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => ({ ...row, drop: false, message: undefined, date: undefined, dateMode: undefined })) }
        void render()
      }
      return
    }

    if (flow.step === "preview" && flow.preview) {
      if (key.name === "tab") {
        const panes = ["oldGraph", "newGraph", "metadata", "todo", "diff"] as const
        const idx = panes.indexOf(flow.previewPane)
        state = { ...state, rewriteFlow: { ...flow, previewPane: panes[(idx + 1) % panes.length], previewScrollOffset: 0 } }
        void render()
        return
      }
      if (key.name === "up" || key.name === "k") {
        state = { ...state, rewriteFlow: { ...flow, previewScrollOffset: Math.max(0, flow.previewScrollOffset - 1) } }
        void render()
        return
      }
      if (key.name === "down" || key.name === "j") {
        state = { ...state, rewriteFlow: { ...flow, previewScrollOffset: flow.previewScrollOffset + 1 } }
        void render()
        return
      }
      if (key.name === "return") {
        state = state.repository?.upstream
          ? { ...state, rewriteFlow: { ...flow, step: "upstream-confirm", upstreamConfirmation: "", error: undefined } }
          : { ...state, rewriteFlow: { ...flow, step: "applying" } }
        void render()
      }
      return
    }

    if (flow.step === "upstream-confirm") {
      const phrase = `rewrite ${state.repository?.branch ?? ""}`
      if (key.name === "return") {
        state = flow.upstreamConfirmation === phrase
          ? { ...state, rewriteFlow: { ...flow, step: "applying", error: undefined } }
          : { ...state, rewriteFlow: { ...flow, error: `Confirmation must match: ${phrase}` } }
        void render()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        state = { ...state, rewriteFlow: { ...flow, upstreamConfirmation: flow.upstreamConfirmation.slice(0, -1) } }
        void render()
        return
      }
      if (isTypableChar(key)) {
        state = { ...state, rewriteFlow: { ...flow, upstreamConfirmation: `${flow.upstreamConfirmation}${key.sequence}` } }
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

function visibleWindowStart(total: number, selectedIndex: number, scrollOffset: number, limit: number): number {
  if (total <= limit) return 0
  if (selectedIndex < scrollOffset) return selectedIndex
  if (selectedIndex >= scrollOffset + limit) return selectedIndex - limit + 1
  return Math.min(Math.max(0, scrollOffset), Math.max(0, total - limit))
}

function isTypableChar(key: KeyEvent): boolean {
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " " && key.name !== "q"
}

function handleHistoryKey(state: AppState, key: KeyEvent): AppState {
  if (key.name === "up" || key.name === "k") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 1), historyScrollOffset: Math.max(0, state.historyScrollOffset - (state.selectedCommitIndex <= state.historyScrollOffset ? 1 : 0)) }
  }
  if (key.name === "down" || key.name === "j") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 1 }
  }
  if (key.name === "pageup") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 18), historyScrollOffset: Math.max(0, state.historyScrollOffset - 18) }
  }
  if (key.name === "pagedown") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 18, historyScrollOffset: state.historyScrollOffset + 18 }
  }
  if (key.name === "backspace" || key.name === "delete") {
    return { ...state, historyQuery: state.historyQuery.slice(0, -1), selectedCommitIndex: 0, historyScrollOffset: 0 }
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
    if (key.sequence === "m") {
      return startHistoryListEditFlow(state)
    }
    // Otherwise append to search filter, excluding shortcut keys.
    if (key.sequence !== "q" && key.sequence !== "w" && key.sequence !== "d" && key.sequence !== "a" && key.sequence !== "t" && key.sequence !== "s" && key.sequence !== "i" && key.sequence !== "m") {
      return { ...state, historyQuery: `${state.historyQuery}${key.sequence}`, selectedCommitIndex: 0, historyScrollOffset: 0 }
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

function toHistoryEditDraft(commit: Awaited<ReturnType<typeof searchCommits>>[number]): HistoryEditDraft {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    authorDate: commit.authorDate,
  }
}

function toHistoryEditOperations(flow: HistoryListEditState): HistoryEditOperation[] {
  return (flow.rows ?? []).flatMap((row) => {
    if (!row.drop && row.message === undefined && row.date === undefined) return []
    return [{
      sha: row.sha,
      drop: row.drop,
      message: row.message,
      date: row.date,
      dateMode: row.dateMode,
    }]
  })
}

async function pushForceWithLease(repoPath: string): Promise<string> {
  const result = await runGitChecked({ repoPath, args: ["push", "--force-with-lease"] })
  return (result.stdout || result.stderr).trim() || "Pushed with --force-with-lease"
}

function updateSelectedHistoryEditRow(flow: HistoryListEditState, update: (row: HistoryEditDraft) => HistoryEditDraft): HistoryListEditState {
  const rows = flow.rows ?? []
  if (rows.length === 0) return flow
  return {
    ...flow,
    rows: rows.map((row, index) => index === flow.selectedRowIndex ? update(row) : row),
    error: undefined,
  }
}

function editHistoryRowText(row: HistoryEditDraft, field: "message" | "date", value: string | -1): HistoryEditDraft {
  const current = field === "message" ? row.message ?? row.subject : row.date ?? row.authorDate
  const next = value === -1 ? current.slice(0, -1) : `${current}${value}`
  return field === "message" ? { ...row, message: next, drop: false } : { ...row, date: next, dateMode: row.dateMode ?? "both", drop: false }
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
