import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { homedir } from "node:os"
import { basename, resolve } from "node:path"
import { loadGitSurgeonConfig, rememberRecentRepo } from "./config"
import { changeCommitAuthor, validateAuthorInput } from "./git/author"
import { getConflictReport, rebaseAbort, rebaseContinue, rebaseSkip } from "./git/conflict"
import { changeOldCommitDate } from "./git/date"
import { buildDropCommitPlan, dropSingleCommit } from "./git/drop"
import { editCommitHistory, type HistoryEditOperation } from "./git/history-plan"
import { getCommitDiff, listCommits, searchCommits } from "./git/log"
import { buildHistoryPreview, withScratchClone } from "./git/preview"
import { visualInteractiveRebase, type VisualRebaseAction, type VisualRebaseRow } from "./git/rebase"
import { validateRepository } from "./git/repository"
import { exportLatestOperationReport } from "./git/report"
import { createRecoveryBranch, getRecoveryReport, previewBackupApplyToUpstream, pushBackupToUpstream } from "./git/recovery"
import { renameOldCommitMessages } from "./git/reword"
import { runGitChecked, stripExitCodeText } from "./git/runner"
import { discoverRepoFolders, filterValidRepoPaths } from "./git/repo-search"
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
  const isSshSession = Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT)
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    remote: isSshSession,
    useMouse: !isSshSession,
    useKittyKeyboard: isSshSession ? null : undefined,
  })
  const config = await loadGitSurgeonConfig()
  const initialRepoPath = normalizeRepoPath(options.repoPath)
  let state: AppState = createInitialState(initialRepoPath)
  const shouldIgnoreStartupTerminalReply = createStartupTerminalReplyFilter()
  const discoveredRepos = await discoverRepoFolders(homedir())
  const pickerPaths = await filterValidRepoPaths(uniquePaths([initialRepoPath, process.cwd(), ...discoveredRepos, ...(options.recentRepos ?? []), ...config.recentRepos].map(normalizeRepoPath)))
  if (initialRepoPath) void rememberRecentRepo(initialRepoPath).catch(() => {})

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
          mount(HistoryScreen(repository, commits, selectedIndex, scrollOffset, state.historyQuery, state.historyQueryCursor, diff, state.historyFilterActive))
        } else if (state.screen === "size-analyzer") {
          const result = await analyzeRepositorySize({ repoPath: repository.repoPath, limit: 20 })
          mount(SizeAnalyzerScreen(repository, result))
        } else if (state.screen === "recovery") {
          const report = await getRecoveryReport(repository.repoPath)
          const selectedRecoveryBackupIndex = clamp(state.selectedRecoveryBackupIndex, 0, Math.max(0, report.backups.length - 1))
          if (selectedRecoveryBackupIndex !== state.selectedRecoveryBackupIndex) state = { ...state, selectedRecoveryBackupIndex }
          mount(RecoveryScreen(repository, report, selectedRecoveryBackupIndex, state.recoveryApplyPreview, { path: state.exportReportPath, error: state.exportReportError }))
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
                rewriteFlow: { ...flow, step: "form", error: userErrorMessage(err) },
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
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) },
              }
            }
            void render()
            return
          }
          mount(RewordFlowScreen(repository, flow))
        } else if (state.screen === "rewrite-drop") {
          const flow = state.rewriteFlow as RewriteDropState
          if (flow.step === "confirm" && !flow.descendants && !flow.planError) {
            try {
              const plan = await buildDropCommitPlan(repository.repoPath, flow.selectedSha)
              state = { ...state, rewriteFlow: { ...flow, descendants: plan.descendants, changedCommitCount: plan.changedCommitCount, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, planError: true, error: userErrorMessage(err) } }
            }
            void render()
            return
          }
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
                rewriteFlow: { ...flow, step: "confirm", error: userErrorMessage(err) },
              }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await dropSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, apply: true })
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) },
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
                rewriteFlow: { ...flow, step: "warning", error: userErrorMessage(err) },
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
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) },
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
                date: dateInputToIso(flow),
                mode: flow.mode,
              })
              state = {
                ...state,
                rewriteFlow: { ...flow, preview: result.preview, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "form", error: userErrorMessage(err) },
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
                date: dateInputToIso(flow),
                mode: flow.mode,
                apply: true,
              })
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) },
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
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: userErrorMessage(err) } }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await editCommitHistory({ repoPath: repository.repoPath, operations: toHistoryEditOperations(flow), apply: true })
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = { ...state, rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) } }
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
              state = { ...state, rewriteFlow: { ...flow, error: userErrorMessage(err) } }
            }
            void render()
            return
          }
          if (flow.step === "preview" && !flow.preview) {
            try {
              const result = await splitSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, parts: toSplitCommitParts(flow) })
              state = { ...state, rewriteFlow: { ...flow, preview: result.preview, error: undefined } }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: userErrorMessage(err) } }
            }
            void render()
            return
          }
          if (flow.step === "applying") {
            try {
              const result = await splitSingleCommit({ repoPath: repository.repoPath, sha: flow.selectedSha, parts: toSplitCommitParts(flow), apply: true })
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) } }
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
              state = { ...state, rewriteFlow: { ...flow, error: userErrorMessage(err) } }
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
              state = { ...state, rewriteFlow: { ...flow, step: "form", error: userErrorMessage(err) } }
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
              const push = await pushForce(repository.repoPath, repository.upstream)
              state = {
                ...state,
                rewriteFlow: { ...flow, step: "result", backupRef: result.backupRef, operationLogPath: result.operationLogPath, pushOutput: push.pushOutput, pushError: push.pushError, error: undefined },
              }
            } catch (err) {
              state = { ...state, rewriteFlow: { ...flow, step: "result", error: userErrorMessage(err) } }
            }
            void render()
            return
          }
          mount(VisualRebaseFlowScreen(repository, flow))
        } else {
          mount(DashboardScreen(repository, state.exitPrompt ? "press esc again to exit" : undefined))
        }
      } catch (error) {
        state = { ...state, screen: "repo-picker", error: userErrorMessage(error) }
        mount(RepoPickerScreen(filteredRepoPaths(pickerPaths, state.repoQuery), state.repoQuery, state.repoQueryCursor, state.selectedRepoIndex, state.error))
      }
    } else {
      if (state.screen === "help") mount(HelpScreen())
      else mount(RepoPickerScreen(filteredRepoPaths(pickerPaths, state.repoQuery), state.repoQuery, state.repoQueryCursor, state.selectedRepoIndex, state.error))
    }
  }

  const enterDashboard = (current: AppState, repoPath: string): AppState => {
    void rememberRecentRepo(repoPath).catch(() => {})
    return {
      ...current,
      screen: "dashboard",
      repoPath,
      repoQuery: "",
      repoQueryCursor: 0,
      selectedRepoIndex: 0,
      exitPrompt: false,
      error: undefined,
      exportReportPath: undefined,
      exportReportError: undefined,
    }
  }

  const handleCurrentScreenKey = (key: KeyEvent) => {
    if (state.screen === "history") {
      const nextState = handleHistoryKey(state, key)
      if (nextState !== state) { state = nextState; void render() }
      return
    }

    if (state.screen === "conflict") { handleConflictKey(key); return }
    if (state.screen === "recovery") { handleRecoveryKey(key); return }
    if (state.screen === "rewrite-reword") { handleRewordKey(key); return }
    if (state.screen === "rewrite-drop") { handleDropKey(key); return }
    if (state.screen === "rewrite-author") { handleAuthorKey(key); return }
    if (state.screen === "rewrite-date") { handleDateKey(key); return }
    if (state.screen === "rewrite-history-list") { handleHistoryListEditKey(key); return }
    if (state.screen === "rewrite-split") { handleSplitKey(key); return }
    if (state.screen === "rewrite-visual-rebase") { handleVisualRebaseKey(key); return }
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (shouldIgnoreStartupTerminalReply(key)) return

    if (state.screen === "repo-picker") {
      const nextState = handleRepoPickerKey(state, key, pickerPaths, enterDashboard, renderer.destroy.bind(renderer))
      if (nextState !== state) { state = nextState; void render() }
      return
    }

    if (isTextEntryActive(state) && isTypableChar(key)) {
      handleCurrentScreenKey(key)
      return
    }

    const clearExitPrompt = key.name !== "escape" && state.exitPrompt

    // Global shortcuts
    if (key.name === "escape") {
      if (state.screen === "dashboard" && state.exitPrompt) { renderer.destroy(); return }
      if (state.screen === "dashboard") state = { ...state, exitPrompt: true }
      else state = backState(state)
      void render()
      return
    }
    if (clearExitPrompt) state = { ...state, exitPrompt: false }
    if (key.name === "r") { void render(); return }
    if (key.sequence === "?") {
      state = { ...state, screen: "help" }
      void render()
      return
    }
    if (key.name === "b" && state.screen !== "repo-picker") {
      state = backState(state)
      void render()
      return
    }

    // Dashboard
    if (state.screen === "dashboard") {
      if (key.name === "h") { state = { ...state, screen: "history", selectedCommitIndex: 0, exitPrompt: false }; void render() }
      if (key.name === "s") { state = { ...state, screen: "size-analyzer", exitPrompt: false }; void render() }
      if (key.name === "v") { state = { ...state, screen: "recovery", exitPrompt: false }; void render() }
      if (key.name === "p") { state = { ...state, screen: "preview", exitPrompt: false }; void render() }
      return
    }

    // History screen: navigation + rewrite triggers
    if (state.screen === "history") {
      handleCurrentScreenKey(key)
      return
    }

    // Conflict screen
    if (state.screen === "conflict") {
      handleCurrentScreenKey(key)
      return
    }

    if (state.screen === "recovery") {
      handleCurrentScreenKey(key)
      return
    }

    // Rewrite flow screens
    if (state.screen.startsWith("rewrite-")) { handleCurrentScreenKey(key); return }
  })

  // Conflict handlers

  function handleRecoveryKey(key: KeyEvent) {
    if (!state.repoPath) return
    if (key.sequence === "e") {
      exportLatestOperationReport({ repoPath: state.repoPath }).then((result) => {
        state = { ...state, exportReportPath: result.outputPath, exportReportError: undefined, recoveryApplyPreview: undefined }
        return render()
      }).catch((error) => {
        state = { ...state, exportReportPath: undefined, exportReportError: userErrorMessage(error), recoveryApplyPreview: undefined }
        return render()
      })
      return
    }
    if (key.sequence === "c") {
      getRecoveryReport(state.repoPath).then((report) => {
        const backup = report.backups[clamp(state.selectedRecoveryBackupIndex, 0, Math.max(0, report.backups.length - 1))]
        if (!backup) throw new Error("No Git Surgeon backup refs found")
        return createRecoveryBranch(state.repoPath!, backup.refName)
      }).then((branch) => {
        state = { ...state, exportReportPath: `Created recovery branch: ${branch}`, exportReportError: undefined, recoveryApplyPreview: undefined }
        return render()
      }).catch((error) => {
        state = { ...state, exportReportPath: undefined, exportReportError: userErrorMessage(error), recoveryApplyPreview: undefined }
        return render()
      })
      return
    }
    if (key.name === "up" || key.name === "down") {
      const direction = key.name === "up" ? -1 : 1
      state = { ...state, selectedRecoveryBackupIndex: Math.max(0, state.selectedRecoveryBackupIndex + direction), exportReportPath: undefined, exportReportError: undefined, recoveryApplyPreview: undefined }
      void render()
      return
    }
    if (key.name === "return") {
      getRecoveryReport(state.repoPath).then(async (report) => {
        const backup = report.backups[clamp(state.selectedRecoveryBackupIndex, 0, Math.max(0, report.backups.length - 1))]
        if (!backup) throw new Error("No Git Surgeon backup refs found")
        if (!state.repository?.upstream) throw new Error("Current branch has no upstream remote to update")
        if (state.recoveryApplyPreview?.backupRef === backup.refName) {
          const output = await pushBackupToUpstream(state.repoPath!, backup.refName, state.repository.upstream)
          return { type: "applied" as const, output }
        }
        const preview = await previewBackupApplyToUpstream(state.repoPath!, backup.refName, state.repository.upstream)
        return { type: "preview" as const, preview }
      }).then((result) => {
        state = result.type === "preview"
          ? { ...state, recoveryApplyPreview: result.preview, exportReportPath: undefined, exportReportError: undefined }
          : { ...state, recoveryApplyPreview: undefined, exportReportPath: result.output, exportReportError: undefined }
        return render()
      }).catch((error) => {
        state = { ...state, recoveryApplyPreview: undefined, exportReportPath: undefined, exportReportError: userErrorMessage(error) }
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
      const edit = editText(flow.newMessage, flow.newMessageCursor, key)
      if (edit) {
        state = { ...state, rewriteFlow: { ...flow, newMessage: edit.value, newMessageCursor: edit.cursor } }
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
          state = { ...state, rewriteFlow: { ...flow, error: userErrorMessage(err) } }
        }
        void render()
        return
      }
      if (key.name === "tab") {
        const fields = ["name", "email", "mode"] as const
        const idx = fields.indexOf(flow.activeField)
        const next = fields[(idx + 1) % fields.length]
        state = { ...state, rewriteFlow: { ...flow, activeField: next } }
        void render()
        return
      }
      if (flow.activeField === "mode" && key.name === "left") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.max(0, idx - 1)] } }
        void render()
        return
      }
      if (flow.activeField === "mode" && key.name === "right") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.min(modes.length - 1, idx + 1)] } }
        void render()
        return
      }
      const editTarget = flow.activeField === "name"
        ? { value: flow.newName, cursor: flow.newNameCursor }
        : flow.activeField === "email"
          ? { value: flow.newEmail, cursor: flow.newEmailCursor }
          : undefined
      const edit = editTarget ? editText(editTarget.value, editTarget.cursor, key) : undefined
      if (edit) {
        if (flow.activeField === "name") {
          state = { ...state, rewriteFlow: { ...flow, newName: edit.value, newNameCursor: edit.cursor } }
        } else {
          state = { ...state, rewriteFlow: { ...flow, newEmail: edit.value, newEmailCursor: edit.cursor } }
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
        try {
          dateInputToIso(flow)
          state = { ...state, rewriteFlow: { ...flow, step: "preview", preview: undefined, error: undefined } }
        } catch (err) {
          state = { ...state, rewriteFlow: { ...flow, error: userErrorMessage(err) } }
        }
        void render()
        return
      }
      if (key.name === "tab") {
        const fields = ["year", "month", "day", "hour", "minute", "second", "timezone", "mode"] as const
        const idx = fields.indexOf(flow.activeField)
        state = { ...state, rewriteFlow: { ...flow, activeField: fields[(idx + 1) % fields.length] } }
        void render()
        return
      }
      if (flow.activeField === "mode" && key.name === "left") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.max(0, idx - 1)] } }
        void render()
        return
      }
      if (flow.activeField === "mode" && key.name === "right") {
        const modes = ["author", "committer", "both"] as const
        const idx = modes.indexOf(flow.mode)
        state = { ...state, rewriteFlow: { ...flow, mode: modes[Math.min(modes.length - 1, idx + 1)] } }
        void render()
        return
      }
      if (flow.activeField === "timezone" && (key.name === "left" || key.name === "right")) {
        const timezones = ["Z", "-12:00", "-08:00", "-05:00", "+00:00", "+01:00", "+05:30", "+08:00", "+09:00", "+12:00"]
        const idx = Math.max(0, timezones.indexOf(flow.timezone))
        const direction = key.name === "left" ? -1 : 1
        state = { ...state, rewriteFlow: { ...flow, timezone: timezones[(idx + direction + timezones.length) % timezones.length] } }
        void render()
        return
      }
      const edit = editDateInputField(flow, key)
      if (edit) {
        state = { ...state, rewriteFlow: edit }
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
          state = { ...state, rewriteFlow: { ...flow, error: userErrorMessage(err) } }
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
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => editHistoryRowText(row, field, key)) }
          void render()
          return
        }
        if (flow.activeField === "date" && (key.sequence === "[" || key.sequence === "]")) {
          const modes = ["author", "committer", "both"] as const
          const selected = rows[flow.selectedRowIndex]
          if (!selected) return
          const idx = modes.indexOf(selected.dateMode ?? "both")
          const next = modes[clamp(idx + (key.sequence === "[" ? -1 : 1), 0, modes.length - 1)]
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => ({ ...row, dateMode: next })) }
          void render()
          return
        }
        if (key.name === "backspace" || key.name === "delete") {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => editHistoryRowText(row, field, key)) }
          void render()
          return
        }
        if (isTypableChar(key)) {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedHistoryEditRow(flow, (row) => editHistoryRowText(row, field, key)) }
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
      if (key.name === "up") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.max(0, flow.selectedRowIndex - 1) } }
        void render()
        return
      }
      if (key.name === "down") {
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
      if (key.name === "up") {
        state = { ...state, rewriteFlow: { ...flow, previewScrollOffset: Math.max(0, flow.previewScrollOffset - 1) } }
        void render()
        return
      }
      if (key.name === "down") {
        state = { ...state, rewriteFlow: { ...flow, previewScrollOffset: flow.previewScrollOffset + 1 } }
        void render()
        return
      }
      if (key.name === "return") {
        state = state.repository?.upstream
          ? { ...state, rewriteFlow: { ...flow, step: "upstream-confirm", upstreamConfirmation: "", upstreamConfirmationCursor: 0, error: undefined } }
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
      const edit = editText(flow.upstreamConfirmation, flow.upstreamConfirmationCursor, key)
      if (edit) {
        state = { ...state, rewriteFlow: { ...flow, upstreamConfirmation: edit.value, upstreamConfirmationCursor: edit.cursor } }
        void render()
        return
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
        if (key.name === "up" || key.name === "down") {
          const direction = key.name === "up" ? -1 : 1
          state = { ...state, rewriteFlow: { ...flow, selectedPartIndex: (flow.selectedPartIndex + direction + flow.parts.length) % flow.parts.length } }
          void render()
          return
        }
        if (key.name === "backspace" || key.name === "delete") {
          state = { ...state, rewriteFlow: updateSelectedSplitPart(flow, key) }
          void render()
          return
        }
        const selectedPart = flow.parts[flow.selectedPartIndex]
        if (selectedPart && editText(selectedPart.message, selectedPart.messageCursor, key)) {
          state = { ...state, rewriteFlow: updateSelectedSplitPart(flow, key) }
          void render()
          return
        }
      }
      if (key.name === "tab") {
        state = { ...state, rewriteFlow: { ...flow, activeField: "message" } }
        void render()
        return
      }
      if (flow.activeField !== "paths") return
      if (key.name === "up") {
        state = { ...state, rewriteFlow: { ...flow, selectedPathIndex: Math.max(0, flow.selectedPathIndex - 1) } }
        void render()
        return
      }
      if (key.name === "down") {
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
        const message = `${flow.selectedSubject} (part ${flow.parts.length + 1})`
        state = { ...state, rewriteFlow: { ...flow, parts: [...flow.parts, { message, messageCursor: message.length }], selectedPartIndex: flow.parts.length } }
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
          state = { ...state, rewriteFlow: updateSelectedVisualRow(flow, (row) => editVisualRowText(row, field, key)) }
          void render()
          return
        }
        if (key.name === "left" || key.name === "right" || isTypableChar(key)) {
          const field = flow.activeField
          state = { ...state, rewriteFlow: updateSelectedVisualRow(flow, (row) => editVisualRowText(row, field, key)) }
          void render()
          return
        }
      }
      if (key.name === "up") {
        state = { ...state, rewriteFlow: { ...flow, selectedRowIndex: Math.max(0, flow.selectedRowIndex - 1) } }
        void render()
        return
      }
      if (key.name === "down") {
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

function normalizeRepoPath(repoPath: string | undefined): string | undefined {
  return repoPath ? resolve(repoPath) : undefined
}

function filteredRepoPaths(paths: string[], query: string): string[] {
  const normalized = normalizeSearchText(query)
  if (!normalized) return paths

  return paths
    .map((path, index) => ({ path, index, score: scoreRepoPath(path, normalized) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.path)
}

function scoreRepoPath(path: string, query: string): number {
  const folder = normalizeSearchText(basename(path))
  const fullPath = normalizeSearchText(path)
  const folderScore = scoreSearchCandidate(folder, query)
  const pathScore = scoreSearchCandidate(fullPath, query)
  return Math.max(folderScore * 3, pathScore)
}

function scoreSearchCandidate(candidate: string, query: string): number {
  if (!candidate || !query) return 0
  if (candidate === query) return 1000
  if (candidate.startsWith(query)) return 850 - candidate.length
  const substringIndex = candidate.indexOf(query)
  if (substringIndex >= 0) return 700 - substringIndex - candidate.length / 100

  let queryIndex = 0
  let score = 0
  let streak = 0
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < query.length; candidateIndex++) {
    if (candidate[candidateIndex] !== query[queryIndex]) {
      streak = 0
      continue
    }
    streak += 1
    score += 10 + streak * 5
    queryIndex += 1
  }

  if (queryIndex < query.length) return 0
  return score - candidate.length / 50
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function handleRepoPickerKey(state: AppState, key: KeyEvent, paths: string[], enterDashboard: (current: AppState, repoPath: string) => AppState, exit: () => void): AppState {
  const filtered = filteredRepoPaths(paths, state.repoQuery)
  if (key.name === "return") {
    const selected = filtered[clamp(state.selectedRepoIndex, 0, Math.max(0, filtered.length - 1))]
    if (selected) return enterDashboard(state, selected)
    return state
  }
  if (key.name === "escape") {
    if (state.exitPrompt) exit()
    return { ...state, exitPrompt: true, error: "press esc again to exit" }
  }
  if (key.name === "up") return { ...state, selectedRepoIndex: Math.max(0, state.selectedRepoIndex - 1), exitPrompt: false }
  if (key.name === "down") return { ...state, selectedRepoIndex: Math.min(Math.max(0, filtered.length - 1), state.selectedRepoIndex + 1), exitPrompt: false }
  const queryEdit = editText(state.repoQuery, state.repoQueryCursor, key)
  if (queryEdit) return { ...state, repoQuery: queryEdit.value, repoQueryCursor: queryEdit.cursor, selectedRepoIndex: 0, exitPrompt: false, error: undefined }
  return state.exitPrompt ? { ...state, exitPrompt: false, error: undefined } : state
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
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " "
}

function createStartupTerminalReplyFilter(): (key: KeyEvent) => boolean {
  const startedAt = Date.now()
  const hardWindowMs = 1
  const tailWindowMs = 1
  let tailDiscarding = false

  return (key: KeyEvent): boolean => {
    const elapsed = Date.now() - startedAt
    if (elapsed < hardWindowMs) return true
    if (elapsed > tailWindowMs) return false

    if (tailDiscarding) {
      if (/^[A-Za-z~]$/.test(key.sequence)) tailDiscarding = false
      return true
    }
    if (key.name === "escape") return true
    if (key.sequence.length > 1) return true
    if (key.sequence === "[") {
      tailDiscarding = true
      return true
    }
    if (/^[0-9;?$"' ]$/.test(key.sequence)) return true
    return false
  }
}

function userErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return stripExitCodeText(message)
}

function isTextEntryActive(state: AppState): boolean {
  if (state.screen === "history") return state.historyFilterActive
  const flow = state.rewriteFlow
  if (!flow) return false

  if (flow.type === "reword") return flow.step === "form"
  if (flow.type === "author") return flow.step === "form" && flow.activeField !== "mode"
  if (flow.type === "date") return flow.step === "form" && ["year", "month", "day", "hour", "minute", "second"].includes(flow.activeField)
  if (flow.type === "history-list") return (flow.step === "form" && flow.activeField !== "list") || flow.step === "upstream-confirm"
  if (flow.type === "split") return flow.step === "form" && flow.activeField === "message"
  if (flow.type === "visual-rebase") return flow.step === "form" && flow.activeField !== "list"
  return false
}

function editText(value: string, cursor: number | undefined, key: KeyEvent): { value: string; cursor: number } | undefined {
  const index = clamp(cursor ?? value.length, 0, value.length)
  if (key.name === "left") return { value, cursor: Math.max(0, index - 1) }
  if (key.name === "right") return { value, cursor: Math.min(value.length, index + 1) }
  if (key.name === "home") return { value, cursor: 0 }
  if (key.name === "end") return { value, cursor: value.length }
  if (key.name === "backspace") {
    if (index === 0) return { value, cursor: 0 }
    return { value: `${value.slice(0, index - 1)}${value.slice(index)}`, cursor: index - 1 }
  }
  if (key.name === "delete") return { value: `${value.slice(0, index)}${value.slice(index + 1)}`, cursor: index }
  if (isTypableChar(key)) return { value: `${value.slice(0, index)}${key.sequence}${value.slice(index)}`, cursor: index + key.sequence.length }
  return undefined
}

function dateInputToIso(flow: RewriteDateState): string {
  const value = `${flow.dateYear}-${flow.dateMonth}-${flow.dateDay}T${flow.dateHour}:${flow.dateMinute}:${flow.dateSecond}${flow.timezone}`
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("Enter a complete date/time and choose a timezone")
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new Error("Date/time is not valid")
  return value
}

function editDateInputField(flow: RewriteDateState, key: KeyEvent): RewriteDateState | undefined {
  if (flow.activeField === "mode" || flow.activeField === "timezone") return undefined
  const field = flow.activeField
  const valueKey = `date${capitalizeDateField(field)}` as const
  const cursorKey = `${valueKey}Cursor` as const
  const edit = editText(flow[valueKey], flow[cursorKey], key)
  if (!edit) return undefined
  return { ...flow, [valueKey]: edit.value, [cursorKey]: edit.cursor }
}

function capitalizeDateField(field: "year" | "month" | "day" | "hour" | "minute" | "second"): "Year" | "Month" | "Day" | "Hour" | "Minute" | "Second" {
  if (field === "year") return "Year"
  if (field === "month") return "Month"
  if (field === "day") return "Day"
  if (field === "hour") return "Hour"
  if (field === "minute") return "Minute"
  return "Second"
}

function backState(state: AppState): AppState {
  const flow = state.rewriteFlow
  if (state.screen === "history" && state.historyFilterActive) return { ...state, historyFilterActive: false, exitPrompt: false }
  if (!flow) return { ...state, screen: "dashboard", exitPrompt: false }

  if (flow.type === "reword") {
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "drop") {
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "confirm", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "author") {
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "warning", error: undefined }, exitPrompt: false }
    if (flow.step === "warning") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "date") {
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "history-list") {
    if (flow.step === "form" && flow.activeField !== "list") return { ...state, rewriteFlow: { ...flow, activeField: "list" }, exitPrompt: false }
    if (flow.step === "dirty") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    if (flow.step === "upstream-confirm") return { ...state, rewriteFlow: { ...flow, step: "preview", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "split") {
    if (flow.step === "form" && flow.activeField === "message") return { ...state, rewriteFlow: { ...flow, activeField: "paths" }, exitPrompt: false }
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }
  if (flow.type === "visual-rebase") {
    if (flow.step === "form" && flow.activeField !== "list") return { ...state, rewriteFlow: { ...flow, activeField: "list" }, exitPrompt: false }
    if (flow.step === "preview") return { ...state, rewriteFlow: { ...flow, step: "form", error: undefined }, exitPrompt: false }
    return { ...state, screen: "history", rewriteFlow: undefined, exitPrompt: false }
  }

  return { ...state, screen: "dashboard", rewriteFlow: undefined, exitPrompt: false }
}

function handleHistoryKey(state: AppState, key: KeyEvent): AppState {
  if (state.historyFilterActive) {
    if (key.name === "escape") return { ...state, historyFilterActive: false }
    const queryEdit = editText(state.historyQuery, state.historyQueryCursor, key)
    if (queryEdit) return { ...state, historyQuery: queryEdit.value, historyQueryCursor: queryEdit.cursor, selectedCommitIndex: 0, historyScrollOffset: 0 }
    return state
  }

  if (key.sequence === "f") {
    return { ...state, historyFilterActive: true, historyQueryCursor: state.historyQuery.length }
  }
  if (key.name === "up") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 1), historyScrollOffset: Math.max(0, state.historyScrollOffset - (state.selectedCommitIndex <= state.historyScrollOffset ? 1 : 0)) }
  }
  if (key.name === "down") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 1 }
  }
  if (key.name === "pageup") {
    return { ...state, selectedCommitIndex: Math.max(0, state.selectedCommitIndex - 18), historyScrollOffset: Math.max(0, state.historyScrollOffset - 18) }
  }
  if (key.name === "pagedown") {
    return { ...state, selectedCommitIndex: state.selectedCommitIndex + 18, historyScrollOffset: state.historyScrollOffset + 18 }
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

async function pushForce(repoPath: string, upstream?: string): Promise<{ pushOutput?: string; pushError?: string }> {
  if (!upstream) return { pushError: "No upstream remote configured; local rewrite applied but not pushed" }
  const match = upstream.match(/^([^/]+)\/(.+)$/)
  if (!match) return { pushError: `Current branch has no pushable upstream: ${upstream}` }
  const [, remote, branch] = match
  try {
    const result = await runGitChecked({ repoPath, args: ["push", "--force-with-lease", remote, `HEAD:refs/heads/${branch}`] })
    return { pushOutput: (result.stdout || result.stderr).trim() || `Pushed HEAD to ${upstream}` }
  } catch (err) {
    const message = userErrorMessage(err)
    return { pushError: `git push --force-with-lease failed: ${message}` }
  }
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

function editHistoryRowText(row: HistoryEditDraft, field: "message" | "date", key: KeyEvent): HistoryEditDraft {
  const current = field === "message" ? row.message ?? row.subject : row.date ?? row.authorDate
  const cursor = field === "message" ? row.messageCursor : row.dateCursor
  const edit = editText(current, cursor, key)
  if (!edit) return row
  return field === "message"
    ? { ...row, message: edit.value, messageCursor: edit.cursor, drop: false }
    : { ...row, date: edit.value, dateCursor: edit.cursor, dateMode: row.dateMode ?? "both", drop: false }
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

function updateSelectedSplitPart(flow: SplitCommitState, key: KeyEvent): SplitCommitState {
  return {
    ...flow,
    parts: flow.parts.map((part, index) => {
      if (index !== flow.selectedPartIndex) return part
      const edit = editText(part.message, part.messageCursor, key)
      return edit ? { ...part, message: edit.value, messageCursor: edit.cursor } : part
    }),
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

function editVisualRowText(row: VisualRebaseTodoRow, field: "message" | "command", key: KeyEvent): VisualRebaseTodoRow {
  const current = field === "message" ? row.message ?? row.subject : row.command ?? ""
  const cursor = field === "message" ? row.messageCursor : row.commandCursor
  const edit = editText(current, cursor, key)
  if (!edit) return row
  return field === "message" ? { ...row, message: edit.value, messageCursor: edit.cursor } : { ...row, command: edit.value, commandCursor: edit.cursor }
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
