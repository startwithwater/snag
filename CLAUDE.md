# Snag — Claude Code Context

## What This Project Is

Snag is a Windows Electron desktop app (with a companion Chrome extension) that
lets a user paste a video/audio link, pick a quality, and download it — powered
by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg under the hood.

## Division of Labor

- **Claude Code** is the primary tool and sole Git integration surface (commits, pushes, tags, releases, branches, worktrees).
- **Codex** may edit and review, but must not `git add`, commit, push, create branches, create or remove worktrees, or write Git history without explicit instruction.

See `AGENTS.md` for the cross-tool working agreement, the review protocol, and the worktree self-check Codex runs before any edit task. See "Solo Developer Workflow" below for how Claude decides branch vs. worktree vs. plain edits.

## Repository Structure

```
snag/
├── CLAUDE.md              This file
├── AGENTS.md               Cross-agent working agreement
├── .gitignore              Git ignore rules
├── .githooks/
│   └── post-commit         Auto-push after commit (enabled via git config core.hooksPath .githooks)
├── src/                     Electron main/renderer source
├── extension/               Chrome extension (companion "click to grab" button)
├── scripts/                 Build/tooling scripts (e.g. prepare-tools.mjs for yt-dlp/ffmpeg)
├── build/                   Electron-builder assets (icons, etc.) + fetched tools/ (gitignored)
├── resources/               App resources
├── docs/                    README images/assets
├── tests/                   Vitest tests
└── .github/                 CI workflows
```

## Commands

- `npm run dev` — run the app in dev mode (electron-vite dev)
- `npm run build` — build (electron-vite build)
- `npm test` — run the Vitest suite
- `npm run typecheck` — typecheck both main and renderer (`typecheck:node` + `typecheck:web`)
- `npm run prepare:tools` / `npm run validate:tools` — fetch/validate the bundled yt-dlp/ffmpeg binaries
- `npm run dist` / `npm run dist:dir` — produce a Windows installer / unpacked dir via electron-builder

## Coding Standards

[Add project conventions as they emerge.]

## Solo Developer Workflow

- **Single branch (`main`), no PRs.** This is a solo project; branches and worktrees exist only as short-lived isolation tools, not a permanent team-collaboration structure. If this project later grows collaborators, revisit this section.
- **Work freely during a session without committing.** Edit, test, iterate. Commit when you're satisfied, not after every change.
- **Stage only your own files, by explicit path — never `git add .` / `git add -A`.** A broad add can sweep up another session's modified-but-uncommitted files into your commit. Always `git add <specific paths>` for exactly the files your change touched, and confirm with `git status --short` before committing that nothing unexpected is staged. Explicit-path staging guards against foreign *files*, not foreign *changes inside a shared file* — `git status --short` is file-level, so it won't warn you that a file you legitimately own a piece of (e.g. `CLAUDE.md`) also holds a parallel session's edits. `git add <path>` takes the whole file. Before staging any file that was already modified when your session started, check `git diff -- <path>` is entirely yours; if it's mixed, leave it uncommitted rather than committing someone else's work under your message.
- **The user does not manage Git directly — Claude decides branch vs. worktree vs. plain working-tree edits, and narrates the decision.** Every session picks the right isolation level for the request and says which it picked and why, in plain language, before starting work:
  - **Default — edit directly on `main`, uncommitted, no branch.** Normal case: one task, one active session, nothing else running concurrently.
  - **Worktree — when a second task needs to run concurrently with one already in flight.** If a new request starts while another edit is still uncommitted/in-progress (this session, a parallel session, or Codex), create a git worktree in a sibling directory (e.g. `../<project>-<short-task-name>`) on a throwaway branch (`wt/<short-task-name>`), and do the new work there instead of touching the primary working copy. State the worktree path and branch name when created. When the task is done, merge or fast-forward it back into `main` (still no PRs) and remove the worktree (`git worktree remove`), narrating both steps.
  - **Long-lived branch — only on explicit request.** Create a durable (non-worktree) branch only when the user explicitly wants to keep something separate for a while (e.g. a risky experiment they might discard). Don't create branches that outlive a single task otherwise.
  - **Never:** forks (not applicable to a solo repo), rebasing published history, or any destructive Git operation without asking first.
  - **Applies to Codex too — see `AGENTS.md`.** Codex may CREATE a worktree for itself when its pre-edit check finds the primary tree occupied (creation is safe and reversible), but never merges, removes worktrees, deletes branches, or commits — integration and cleanup remain Claude's alone. Codex is also commonly run directly by the user in its own terminal, independent of Claude, so it cannot always assume Claude has pre-staged a worktree for it. Because Codex work can land in the primary checkout, a worktree it was pointed at, or a worktree it created itself, run `git worktree list` before reviewing or committing Codex's output to find where the work actually landed; never assume the primary checkout by default. Abandoned Codex-created worktrees are surfaced to the user before removal, like any destructive op.
- **Post-commit auto-push is active if `.githooks/post-commit` is installed** (`git config core.hooksPath .githooks`, done once by the bootstrap). Every local commit pushes to origin automatically — know that before committing something you're not ready to publish. Disable by unsetting that config or removing the hook file.

## Preferred Working Style

[Add preferences as needed.]
