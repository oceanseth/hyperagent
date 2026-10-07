#!/usr/bin/env bash
# Stop this linked worktree's dev server and portless route.
# With --remove-worktree, also run git worktree remove on this worktree.
# --force allows removal when the worktree has uncommitted changes.
set -euo pipefail

remove=0
force=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --remove-worktree) remove=1 ;;
    --force) force=1 ;;
    *)
      echo "worktree-teardown: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

die() {
  echo "worktree-teardown: $*" >&2
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

is_ancestor() {
  local pid=$1
  local cursor=$2
  while [[ $cursor -gt 1 ]]; do
    if [[ $cursor -eq $pid ]]; then
      return 0
    fi
    cursor=$(ps -o ppid= -p "$cursor" | tr -d ' ')
    [[ -n $cursor ]] || break
  done
  return 1
}

stop_servers() {
  local root=$1
  local pid cwd cmd
  local -a victims=()
  for pid in /proc/[0-9]*; do
    pid=${pid#/proc/}
    [[ $pid =~ ^[0-9]+$ ]] || continue
    is_ancestor "$pid" "$$" && continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    [[ -n $cwd ]] || continue
    case $cwd in
      "$root"|"$root"/*) ;;
      *) continue ;;
    esac
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case $cmd in
      *portless*|*vite*|*dotenv*|*pnpm*) ;;
      *) continue ;;
    esac
    victims+=("$pid")
  done
  if [[ ${#victims[@]} -eq 0 ]]; then
    return 0
  fi
  kill -TERM "${victims[@]}" 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    local alive=0
    for pid in "${victims[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    [[ $alive -eq 0 ]] && return 0
    sleep 0.2
  done
  kill -KILL "${victims[@]}" 2>/dev/null || true
}

root=$(git rev-parse --show-toplevel)
cd "$root"
root=$(pwd -P)
main=$(main_checkout)

if [[ $root == "$main" ]]; then
  die "refusing to run in the main checkout ($main)"
fi

stop_servers "$root"

if [[ $remove -eq 0 ]]; then
  exit 0
fi

if [[ $force -eq 0 ]] && [[ -n $(git -C "$root" status --porcelain) ]]; then
  die "refusing to remove $root with uncommitted changes (pass --force)"
fi

cd "$main"
if [[ $force -eq 1 ]]; then
  git -C "$main" worktree remove --force "$root"
else
  git -C "$main" worktree remove "$root"
fi
