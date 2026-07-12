# Cross-Agent Working Agreement

This repository is shared between Claude Code and Codex. Both tools use the
same working tree, but neither inherits the other's conversation context,
skills, hooks, approvals, or automatic workflow.

Read `CLAUDE.md` before making, reviewing, or shipping a change. It is the
project's canonical technical and release guidance.

## Change discovery and review

Run `git worktree list` first. The primary tree is not a safe default
assumption — Claude may have created an isolated worktree for a task (see
"Worktree isolation" below), and Codex may have been pointed at it directly.
If more than one worktree is listed, confirm with the user (or infer from
what you were told about the task) which one holds the work under review,
and run everything below from inside that directory, not reflexively from
the primary checkout.

When asked to find, review, continue, or ship work that may have been made by
another tool or local process, do not rely on a conversation summary or a
single Git command. First inventory the workspace with:

```powershell
git status --short --untracked-files=all
git status --short --ignored=matching --untracked-files=all
git diff HEAD
git diff --cached
git ls-files --others --exclude-standard
```

Treat tracked modifications and non-ignored untracked files as reviewable
change candidates. Report ignored paths as metadata only unless the user
explicitly asks to inspect one. Ignored paths may contain credentials, PII,
database exports, or runtime state; never open them by default.

Do not assume a clean Git diff means the entire working directory is clean:
ignored local-only artifacts are intentionally excluded from Git review.
Never stage another agent's files — stage by explicit path (see `CLAUDE.md`).
Explicit-path staging guards against foreign *files*, not foreign *changes
inside a shared file*: `git add <path>` stages the whole file. Before staging
any file that was already modified when your session started, verify
`git diff -- <path>` shows only your changes — if it is mixed with another
session's work, leave it uncommitted for whoever owns the rest.

## Division of labor: Codex edits, Claude commits

Claude Code is the primary tool and the sole Git integration surface for this
repository. Codex may edit and review, but must not `git add`, commit, push,
or otherwise write Git history without explicit instruction. One carve-out:
Codex MAY create a worktree for itself when its pre-edit check finds the
primary tree occupied — creation is a safe, reversible operation (new
directory, new throwaway branch, touches no existing history). Integration
stays exclusively Claude's: Codex never merges, never removes worktrees,
never deletes branches. Its work is handed off uncommitted for Claude
to review and commit. When Codex finishes a change, it should list every
file it created or modified so the reviewer has an explicit change set.
Claude reviews Codex work per the inventory above and commits it by explicit
path (see the staging rule in `CLAUDE.md`).

## Worktree isolation for concurrent work

The user does not manage Git directly. Claude decides when a task needs a
separate git worktree (see CLAUDE.md's "Solo Developer Workflow" section).
Codex may CREATE a worktree for itself under the occupied-tree condition
below, but never merges, removes worktrees, deletes branches, or commits, on
its own initiative or otherwise — integration and cleanup are Claude's alone,
consistent with the division-of-labor rule above.

Codex reaches this repo two ways: dispatched by Claude mid-session, or run
directly by the user in its own terminal with no Claude session involved at
all. The second path means Codex cannot assume a worktree has already been
prepared for it — it must check for itself:

- **Verification / read-only work (confirming an approach, checking a
  technical assumption, researching something) needs no check at all** — it
  can't collide with anything else. Proceed straight to the task.
- **Told an explicit directory** (by the user, or by Claude handing off a
  worktree path) — treat that path as the working tree for the task and
  skip the check below; you were placed there deliberately.
- **Anything else that edits files** — before touching anything, run
  `git worktree list` and `git status --short --untracked-files=all` in the
  target directory:
  - Only the primary worktree, and it's clean (or only shows changes you
    already made earlier in this same task) → proceed directly in the
    primary checkout. This mirrors Claude's own default tier.
  - Unrecognized uncommitted changes in the primary tree, or another
    worktree already exists → that's a signal of unrelated in-flight work
    (a Claude session, or a parallel Codex/user session). Do not edit on top
    of it. Instead, create an isolated worktree for this task and proceed
    there: `git worktree add ../<project>-<short-task-name> -b wt/<short-task-name>`
    (sibling directory, throwaway branch — same convention Claude uses).
    Announce the path and branch name immediately, and again in the handoff.
    Do not merge it back or remove it when done — hand off and leave
    integration to Claude.

  Know what a fresh worktree does NOT contain before choosing it: it is a
  checkout of the last COMMIT, so (a) gitignored files are absent — no
  `.env` credentials, no `node_modules/`, no local `.codex/` config — and
  (b) none of the primary tree's uncommitted changes come along, so a task
  that must build on in-flight uncommitted work cannot be done in a worktree
  at all. If the task needs any of those, stop and tell the user instead of
  producing edits against stale or credential-less state.

Hand off finished work the same way regardless of which working tree was
used: list every file created or modified, and state the directory path you
worked in if it's anything other than the primary checkout, so the reviewer
knows where to look.

## Handoff prompt

For a cross-tool review, use: "Perform the cross-agent workspace inventory in
AGENTS.md, then review every tracked or non-ignored changed file. List ignored
local-only paths as metadata and do not read them unless I approve."
