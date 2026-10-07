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

stop_servers() {
  local root=$1
  # One pass over /proc. A bash loop that forked ps or tr per PID stalled for
  # minutes and delayed the signal to this worktree's dev server.
  python3 - "$root" "$$" <<'PY'
import os, signal, sys, time
root = sys.argv[1]
skip = set()
cursor = int(sys.argv[2])
while cursor > 1:
    skip.add(cursor)
    try:
        ppid = None
        with open(f"/proc/{cursor}/status", encoding="ascii", errors="replace") as fh:
            for line in fh:
                if line.startswith("PPid:"):
                    ppid = int(line.split()[1])
                    break
        if ppid is None:
            break
        cursor = ppid
    except OSError:
        break
tokens = ("portless", "vite", "dotenv", "pnpm")
victims = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    pid = int(name)
    if pid in skip:
        continue
    try:
        cwd = os.readlink(f"/proc/{pid}/cwd")
        raw = os.open(f"/proc/{pid}/cmdline", os.O_RDONLY | os.O_NONBLOCK)
        try:
            cmd = os.read(raw, 65536).replace(b"\0", b" ").decode(errors="replace")
        finally:
            os.close(raw)
    except OSError:
        continue
    if cwd != root and not cwd.startswith(root + os.sep):
        continue
    if pid == os.getpid():
        continue
    # Drop the worktree path before matching. A directory named portless-*
    # is not a portless process, and this helper's argv contains that path.
    if not any(token in cmd.replace(root, " ") for token in tokens):
        continue
    victims.append(pid)
for pid in victims:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
for _ in range(25):
    if not any(os.path.exists(f"/proc/{pid}") for pid in victims):
        break
    time.sleep(0.2)
else:
    for pid in victims:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
PY
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
