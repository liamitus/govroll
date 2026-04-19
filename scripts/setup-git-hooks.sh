#!/usr/bin/env sh
#
# Pin git's hooks directory to the project's `.husky/` dir so project-level
# pre-commit / pre-push hooks actually fire — regardless of:
#
#   1. Any user-global `core.hooksPath` override in ~/.gitconfig
#      (repo-local config wins over global, which is why we set --local here).
#
#   2. Stale worktree-specific overrides. Git worktrees can carry their own
#      `config.worktree` with an absolute path — we've seen worktrees with a
#      hardcoded path pointing at the MAIN repo's `.husky/_`, which means
#      hooks in the worktree silently no-op. We unset that override so the
#      worktree inherits the main repo's relative `.husky`.
#
#   3. Legacy husky v8 layouts. Husky v9 keeps hook files in `.husky/<name>`;
#      some older configs point at `.husky/_/` (husky v8 shim dir). We
#      normalize to `.husky`.
#
# Called from the `prepare` npm lifecycle script so `npm install` in any
# clone or worktree self-heals.
set -e

# If we're not inside a git repo (e.g. when npm installs from a tarball in
# CI cache), there's nothing to configure. Silent exit — never fail
# `npm install` for this reason.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Point at the project-relative `.husky` directory. Husky v9 writes hook
# files there directly, and each worktree has its own checkout of that dir
# so the path resolves correctly in every checkout.
git config --local core.hooksPath .husky

# Remove any worktree-local override. The `--worktree` flag requires
# `extensions.worktreeConfig = true`, which git sets automatically when a
# config.worktree file exists. If there's no override to unset, git
# returns a non-zero exit — swallow it.
if [ -f "$(git rev-parse --git-dir)/config.worktree" ]; then
  git config --worktree --unset-all core.hooksPath 2>/dev/null || true
fi
