#!/usr/bin/env bash
# Bootstrap a linked hyperagent worktree from the main checkout.
# Copies the gitignored runtime manifest, trusts direnv, and installs web/
# dependencies from the shared pnpm store. Does not start a dev server.
set -euo pipefail

# One manifest for gitignored runtime inputs. Add new env files, local
# datasets, credential files, and generated artifacts needed at runtime here
# in the same change that introduces them.
MANIFEST=(
  web/.env.local
)

die() {
  echo "worktree-setup: $*" >&2
  exit 1
}

main_checkout() {
  if [[ -n ${HYPERAGENT_MAIN_CHECKOUT:-} ]]; then
    if [[ ! -d $HYPERAGENT_MAIN_CHECKOUT ]]; then
      die "HYPERAGENT_MAIN_CHECKOUT is not a directory"
    fi
    (cd "$HYPERAGENT_MAIN_CHECKOUT" && pwd -P)
    return
  fi
  local line
  line=$(git worktree list --porcelain | awk 'NR==1 && $1=="worktree" { print substr($0, 10); exit }')
  [[ -n $line ]] || die "could not read the main checkout from git worktree list"
  (cd "$line" && pwd -P)
}

root=$(git rev-parse --show-toplevel)
cd "$root"
root=$(pwd -P)
main=$(main_checkout)

if [[ $root == "$main" ]]; then
  die "refusing to run in the main checkout ($main); create a linked worktree first"
fi

git_dir=$(git rev-parse --git-dir)
git_common=$(git rev-parse --git-common-dir)
git_dir=$(cd "$git_dir" && pwd -P)
git_common=$(cd "$git_common" && pwd -P)
if [[ $git_dir == "$git_common" ]]; then
  die "refusing to run outside a linked worktree"
fi

for rel in "${MANIFEST[@]}"; do
  src="$main/$rel"
  if [[ ! -f $src ]]; then
    die "missing manifest file: $rel"
  fi
  dest="$root/$rel"
  mkdir -p "$(dirname "$dest")"
  if [[ -f $dest ]] && cmp -s "$src" "$dest" && [[ $(stat -c %a "$dest") == 600 ]]; then
    continue
  fi
  install -m 600 "$src" "$dest"
done

if ! command -v direnv >/dev/null 2>&1; then
  die "direnv is required. Install it with: sudo apt-get install -y direnv"
fi
direnv allow "$root"

if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm is required (packageManager is pnpm@12.4.2)"
fi
pnpm install --frozen-lockfile --prefer-offline --dir "$root/web"
# The MCP proof is `node --import tsx web/scripts/mcp-board-proof.mjs` from the
# worktree root. Node resolves that loader from the root, while pnpm installs
# tsx under web/node_modules.
mkdir -p "$root/node_modules"
ln -sfn ../web/node_modules/tsx "$root/node_modules/tsx"
