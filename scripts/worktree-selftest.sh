#!/usr/bin/env bash
# Proves the worktree lifecycle. Each subcommand creates temporary linked
# worktrees and removes them before it exits.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd -P)
MAIN=$(git -C "$repo" worktree list --porcelain | awk 'NR==1 && $1=="worktree" { print substr($0, 10); exit }')
MAIN=$(cd "$MAIN" && pwd -P)
command_name=${1:-}
shift || true

die() {
  echo "worktree-selftest: $*" >&2
  exit 1
}

[[ -n $command_name ]] || die "usage: worktree-selftest.sh store|setup|portless|teardown|direnv"

worktrees=()
branches=()
STATE_DIR=
PROXY_PORT=
dev_pids=()

same_fs_base() {
  local store device candidate
  store=$(pnpm store path)
  device=$(stat -c %d "$store")
  for candidate in /home/debian/.cache /home/debian; do
    if [[ -d $candidate && $(stat -c %d "$candidate") == "$device" ]]; then
      local dir="$candidate/hyperagent-wt-selftest-$$-$RANDOM"
      mkdir -p "$dir"
      printf '%s\n' "$dir"
      return
    fi
  done
  die "no directory on the same filesystem as the pnpm store ($store)"
}

BASE=$(same_fs_base)

stop_tree() {
  python3 - "$1" <<'PY'
import os, signal, sys, time
root = os.path.realpath(sys.argv[1])
pids = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    pid = int(name)
    try:
        cwd = os.path.realpath(os.readlink(f"/proc/{pid}/cwd"))
        cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        continue
    if cwd != root and not cwd.startswith(root + os.sep):
        continue
    if any(token in cmd for token in ("vite", "portless", "dotenv", "pnpm")):
        pids.append(pid)
for pid in pids:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
for _ in range(25):
    if not any(os.path.exists(f"/proc/{pid}") for pid in pids):
        break
    time.sleep(0.2)
for pid in pids:
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
PY
}

cleanup() {
  set +e
  local pid wt branch
  for wt in "${worktrees[@]+"${worktrees[@]}"}"; do
    [[ -n $wt && -d $wt ]] || continue
    stop_tree "$wt"
  done
  for pid in "${dev_pids[@]+"${dev_pids[@]}"}"; do
    [[ -n $pid ]] || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  if [[ -n $STATE_DIR && -n $PROXY_PORT && -x $repo/web/node_modules/.bin/portless ]]; then
    (
      cd /
      PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_SYNC_HOSTS=0 \
        "$repo/web/node_modules/.bin/portless" proxy stop -p "$PROXY_PORT"
    ) >/dev/null 2>&1 || true
  fi
  for wt in "${worktrees[@]+"${worktrees[@]}"}"; do
    [[ -n $wt && -d $wt ]] || continue
    git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1 || true
  done
  for branch in "${branches[@]+"${branches[@]}"}"; do
    [[ -n $branch ]] || continue
    git -C "$repo" branch -D "$branch" >/dev/null 2>&1 || true
  done
  [[ -n $BASE && -d $BASE ]] && rm -rf "$BASE"
  git -C "$repo" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

add_worktree() {
  local name=$1
  local branch="wt-selftest-$name-$$"
  local path="$BASE/$name"
  git -C "$repo" worktree add -b "$branch" "$path" HEAD >/dev/null
  worktrees+=("$path")
  branches+=("$branch")
  printf '%s\n' "$path"
}

assert_no_secrets() {
  python3 - "$1" "$MAIN/web/.env.local" <<'PY'
import sys
out = open(sys.argv[1], errors="replace").read()
for line in open(sys.argv[2], errors="replace"):
    if "=" not in line or line.lstrip().startswith("#"):
        continue
    value = line.split("=", 1)[1].strip().strip('"').strip("'")
    if len(value) >= 8 and value in out:
        sys.exit(1)
sys.exit(0)
PY
}

main_unchanged() {
  local before=$1
  local after
  after=$(git -C "$MAIN" status --porcelain)
  if [[ $before != "$after" ]]; then
    die "main checkout status changed"
  fi
}

env_fingerprint() {
  python3 - "$1/web/.env.local" <<'PY'
import hashlib, os, sys
path = sys.argv[1]
st = os.stat(path)
digest = hashlib.sha256()
digest.update(str(st.st_mtime_ns).encode())
digest.update(str(st.st_mode & 0o777).encode())
digest.update(open(path, "rb").read())
print(digest.hexdigest())
PY
}

server_count() {
  local root=$1
  python3 - "$root" <<'PY'
import os, sys
root = os.path.realpath(sys.argv[1])
count = 0
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    try:
        cwd = os.path.realpath(os.readlink(f"/proc/{name}/cwd"))
        cmd = open(f"/proc/{name}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        continue
    if cwd != root and not cwd.startswith(root + os.sep):
        continue
    if any(token in cmd for token in ("vite", "portless", "dotenv", "pnpm")):
        count += 1
print(count)
PY
}

branch_host() {
  local path=$1
  local branch prefix
  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  prefix=${branch##*/}
  prefix=$(printf '%s' "$prefix" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')
  printf '%s.web.localhost\n' "$prefix"
}

wait_canvas() {
  local url=$1
  local attempt
  for attempt in $(seq 1 90); do
    if curl -fsS --max-time 5 "$url" | python3 -c 'import json,sys; body=json.load(sys.stdin); raise SystemExit(0 if isinstance(body, dict) and "stacks" in body else 1)'; then
      return 0
    fi
    sleep 2
  done
  echo "worktree-selftest: timed out waiting for $url" >&2
  return 1
}

start_proxy() {
  local portless=$1
  STATE_DIR="$BASE/portless-state"
  mkdir -p "$STATE_DIR"
  PROXY_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
  (
    cd /
    PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      "$portless" proxy start --no-tls -p "$PROXY_PORT"
  )
  local attempt
  for attempt in $(seq 1 50); do
    if python3 -c 'import socket,sys; socket.create_connection(("127.0.0.1", int(sys.argv[1])), 1).close()' "$PROXY_PORT"; then
      return 0
    fi
    sleep 0.2
  done
  die "portless proxy did not listen on $PROXY_PORT"
}

start_dev() {
  local wt=$1
  local log=$2
  set -m
  (
    cd "$wt/web"
    exec env -u CI \
      PORTLESS_STATE_DIR="$STATE_DIR" \
      PORTLESS_PORT="$PROXY_PORT" \
      PORTLESS_HTTPS=0 \
      PORTLESS_SYNC_HOSTS=0 \
      pnpm dev
  ) >"$log" 2>&1 &
  dev_pids+=("$!")
  set +m
}

filtered_log() {
  local log=$1
  [[ -f $log ]] || return 0
  grep -Ev 'DATABASE_URL|SECRET|TOKEN|PASSWORD|postgres://|sk_|pk_' "$log" | tail -n 40 >&2 || true
}

case $command_name in
  store)
    main_before=$(git -C "$MAIN" status --porcelain)
    first=$(add_worktree store-a)
    second=$(add_worktree store-b)
    (cd "$first/web" && pnpm install --frozen-lockfile --prefer-offline)
    store_a=$(cd "$first/web" && pnpm store path)
    start=$(date +%s)
    (
      cd "$second/web"
      HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
        https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 \
        pnpm install --frozen-lockfile --offline
    )
    elapsed=$(( $(date +%s) - start ))
    [[ $elapsed -lt 60 ]] || die "offline install took ${elapsed}s"
    store_b=$(cd "$second/web" && pnpm store path)
    [[ $store_a == "$store_b" ]] || die "pnpm store paths differ"
    python3 - "$second/web/node_modules/vite/package.json" "$store_b" <<'PY'
import os, sys
path, store = sys.argv[1:]
st = os.stat(path)
if st.st_nlink <= 1:
    sys.exit(f"link count {st.st_nlink} is not above 1")
if os.stat(store).st_dev != st.st_dev:
    sys.exit("package file is not on the pnpm store filesystem")
PY
    main_unchanged "$main_before"
    ;;

  setup)
    main_before=$(git -C "$MAIN" status --porcelain)
    env_hash=$(sha256sum "$MAIN/web/.env.local" | awk '{print $1}')
    env_mode=$(stat -c %a "$MAIN/web/.env.local")
    set +e
    refuse=$(cd "$MAIN" && bash "$repo/scripts/worktree-setup.sh" 2>&1)
    refuse_code=$?
    set -e
    [[ $refuse_code -ne 0 ]] || die "setup ran in the main checkout"
    printf '%s\n' "$refuse" | grep -q 'main checkout' || die "main-checkout refusal did not name the checkout"
    [[ $(sha256sum "$MAIN/web/.env.local" | awk '{print $1}') == "$env_hash" ]] || die "main env file content changed"
    [[ $(stat -c %a "$MAIN/web/.env.local") == "$env_mode" ]] || die "main env file mode changed"
    assert_no_secrets <(printf '%s\n' "$refuse") || die "main-checkout refusal printed a secret"

    empty="$BASE/empty-main"
    mkdir -p "$empty"
    wt=$(add_worktree setup)
    set +e
    missing=$(cd "$wt" && HYPERAGENT_MAIN_CHECKOUT="$empty" bash scripts/worktree-setup.sh 2>&1)
    missing_code=$?
    set -e
    [[ $missing_code -ne 0 ]] || die "setup succeeded with a missing manifest file"
    printf '%s\n' "$missing" | grep -q 'web/.env.local' || die "missing-file error did not name web/.env.local"
    assert_no_secrets <(printf '%s\n' "$missing") || die "missing-file error printed a secret"

    shim="$BASE/bin"
    mkdir -p "$shim"
    for cmd in git pnpm node npm bash sh sed awk python3 install chmod mkdir cp dirname realpath stat ls; do
      src=$(command -v "$cmd" || true)
      [[ -n $src ]] && ln -sf "$src" "$shim/$cmd"
    done
    set +e
    nodirenv=$(cd "$wt" && PATH="$shim" bash scripts/worktree-setup.sh 2>&1)
    nodirenv_code=$?
    set -e
    [[ $nodirenv_code -ne 0 ]] || die "setup succeeded without direnv"
    printf '%s\n' "$nodirenv" | grep -q 'sudo apt-get install -y direnv' || die "missing direnv hint"
    [[ ! -e $wt/web/node_modules ]] || die "setup installed dependencies without direnv"
    assert_no_secrets <(printf '%s\n' "$nodirenv") || die "direnv hint printed a secret"

    log="$BASE/setup.out"
    (cd "$wt" && bash scripts/worktree-setup.sh) >"$log" 2>&1
    assert_no_secrets "$log" || die "setup printed a secret"
    [[ -x $wt/web/node_modules/.bin/vite && -x $wt/web/node_modules/.bin/dotenv ]] || die "vite or dotenv binary missing"
    [[ $(stat -c %a "$wt/web/.env.local") == 600 ]] || die "copied env file is not mode 600"
    [[ $(server_count "$wt") == 0 ]] || die "setup started a long-running process"
    [[ -z $(git -C "$wt" status --porcelain) ]] || die "setup changed tracked files"
    finger=$(env_fingerprint "$wt")
    status_a=$(git -C "$wt" status --porcelain)
    (cd "$wt" && bash scripts/worktree-setup.sh) >"$BASE/setup-again.out" 2>&1
    assert_no_secrets "$BASE/setup-again.out" || die "second setup printed a secret"
    [[ $(env_fingerprint "$wt") == "$finger" ]] || die "second setup changed the copied env file"
    [[ $(git -C "$wt" status --porcelain) == "$status_a" ]] || die "second setup changed tracked files"
    main_unchanged "$main_before"
    ;;

  portless)
    main_before=$(git -C "$MAIN" status --porcelain)
    grep -q 'portless run' "$repo/web/package.json" || die "dev script does not run portless"
    grep -q -- '--port 3001' "$repo/web/package.json" && die "fixed --port 3001 is still in package.json"
    grep -q 'portless proxy start --no-tls' "$repo/web/README.md" || die "README is missing the headless portless example"
    grep -q 'portless trust' "$repo/web/README.md" || die "README is missing the first-run trust step"
    a=$(add_worktree portless-a)
    b=$(add_worktree portless-b)
    (cd "$a" && bash scripts/worktree-setup.sh)
    (cd "$b" && bash scripts/worktree-setup.sh)
    [[ -x $a/web/node_modules/.bin/portless ]] || die "portless is not installed"
    python3 - "$a/web/package.json" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1]))["devDependencies"]["portless"]
if spec != "0.15.1":
    sys.exit(f"portless is not exact-pinned: {spec}")
PY
    start_proxy "$a/web/node_modules/.bin/portless"
    log_a="$BASE/dev-a.log"
    log_b="$BASE/dev-b.log"
    start_dev "$a" "$log_a"
    start_dev "$b" "$log_b"
    host_a=$(branch_host "$a")
    host_b=$(branch_host "$b")
    [[ $host_a != "$host_b" ]] || die "worktrees did not get distinct hostnames"
    url_a="http://${host_a}:${PROXY_PORT}/api/canvas"
    url_b="http://${host_b}:${PROXY_PORT}/api/canvas"
    if ! wait_canvas "$url_a"; then
      filtered_log "$log_a"
      die "first dev server failed"
    fi
    if ! wait_canvas "$url_b"; then
      filtered_log "$log_b"
      die "second dev server failed"
    fi
    (cd "$a" && PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_PORT="$PROXY_PORT" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      bash scripts/worktree-teardown.sh)
    (cd "$b" && PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_PORT="$PROXY_PORT" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      bash scripts/worktree-teardown.sh)
    dev_pids=()
    (
      cd /
      PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_SYNC_HOSTS=0 \
        "$a/web/node_modules/.bin/portless" proxy stop -p "$PROXY_PORT"
    )
    main_unchanged "$main_before"
    ;;

  teardown)
    main_before=$(git -C "$MAIN" status --porcelain)
    if grep -n 'rm -rf' "$repo/scripts/worktree-teardown.sh" >/dev/null; then
      die "teardown contains rm -rf"
    fi
    env_hash=$(sha256sum "$MAIN/web/.env.local" | awk '{print $1}')
    set +e
    refuse=$(cd "$MAIN" && bash "$repo/scripts/worktree-teardown.sh" 2>&1)
    refuse_code=$?
    set -e
    [[ $refuse_code -ne 0 ]] || die "teardown ran in the main checkout"
    printf '%s\n' "$refuse" | grep -q 'main checkout' || die "teardown refusal did not name the main checkout"
    [[ $(sha256sum "$MAIN/web/.env.local" | awk '{print $1}') == "$env_hash" ]] || die "teardown changed the main env file"
    set +e
    refuse_rm=$(cd "$MAIN" && bash "$repo/scripts/worktree-teardown.sh" --remove-worktree 2>&1)
    refuse_rm_code=$?
    set -e
    [[ $refuse_rm_code -ne 0 ]] || die "teardown --remove-worktree ran in the main checkout"
    [[ -d $MAIN/.git || -f $MAIN/.git ]] || die "main checkout git metadata disappeared"

    a=$(add_worktree teardown-a)
    b=$(add_worktree teardown-b)
    (cd "$a" && bash scripts/worktree-setup.sh)
    (cd "$b" && bash scripts/worktree-setup.sh)
    start_proxy "$a/web/node_modules/.bin/portless"
    log_a="$BASE/dev-a.log"
    log_b="$BASE/dev-b.log"
    start_dev "$a" "$log_a"
    start_dev "$b" "$log_b"
    host_a=$(branch_host "$a")
    host_b=$(branch_host "$b")
    url_a="http://${host_a}:${PROXY_PORT}/api/canvas"
    url_b="http://${host_b}:${PROXY_PORT}/api/canvas"
    wait_canvas "$url_a" || { filtered_log "$log_a"; die "teardown fixture A failed"; }
    wait_canvas "$url_b" || { filtered_log "$log_b"; die "teardown fixture B failed"; }
    (cd "$a" && PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_PORT="$PROXY_PORT" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      bash scripts/worktree-teardown.sh)
    if curl -fsS --max-time 5 "$url_a" >/dev/null 2>&1; then
      die "teardown left the first dev server answering"
    fi
    wait_canvas "$url_b" || die "the other worktree stopped answering"
    (cd "$a" && PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_PORT="$PROXY_PORT" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      bash scripts/worktree-teardown.sh)
    wait_canvas "$url_b" || die "idempotent teardown disturbed the other worktree"

    dirty=$(add_worktree teardown-dirty)
    echo dirty >"$dirty/untracked.txt"
    set +e
    dirty_out=$(cd "$dirty" && bash scripts/worktree-teardown.sh --remove-worktree 2>&1)
    dirty_code=$?
    set -e
    [[ $dirty_code -ne 0 ]] || die "teardown removed a dirty worktree"
    [[ -d $dirty ]] || die "dirty worktree disappeared"
    printf '%s\n' "$dirty_out" | grep -q 'uncommitted' || die "dirty refusal did not mention uncommitted changes"
    (cd "$dirty" && bash scripts/worktree-teardown.sh --remove-worktree --force)
    [[ ! -d $dirty ]] || die "--force did not remove the dirty worktree"

    (cd "$b" && PORTLESS_STATE_DIR="$STATE_DIR" PORTLESS_PORT="$PROXY_PORT" PORTLESS_HTTPS=0 PORTLESS_SYNC_HOSTS=0 \
      bash scripts/worktree-teardown.sh --remove-worktree)
    [[ ! -d $b ]] || die "merged-worktree removal left the worktree in place"
    main_unchanged "$main_before"
    ;;

  direnv)
    main_before=$(git -C "$MAIN" status --porcelain)
    grep -q 'dotenv_if_exists web/.env.local' "$repo/.envrc" || die ".envrc is missing web/.env.local"
    grep -q 'dotenv_if_exists .env' "$repo/.envrc" || die ".envrc dropped dotenv_if_exists .env"
    grep -q 'source bin/activate-hermit' "$repo/.envrc" || die ".envrc dropped hermit activation"
    grep -q 'direnv allow' "$repo/scripts/worktree-setup.sh" || die "setup does not run direnv allow"
    [[ ! -f $repo/web/.envrc ]] || die "web/.envrc must not exist"
    if grep -n -E '(^|[[:space:]])(source|\.)[[:space:]]+[^[:space:]]*\.env' \
      "$repo/scripts/worktree-setup.sh" "$repo/scripts/worktree-teardown.sh" \
      "$repo/web/README.md" "$repo/README.md" "$repo/AGENTS.md" >/dev/null; then
      die "a script or doc loads an env file with the shell"
    fi
    wt=$(add_worktree direnv)
    (cd "$wt" && bash scripts/worktree-setup.sh)
    run_exec() {
      local dir=$1
      local out
      out=$(cd "$dir" && DIRENV_LOG_FORMAT= direnv exec . sh -c 'test -n "$DATABASE_URL"' | grep -v '^Hermit environment ' || true)
      [[ -z $out ]] || die "direnv exec printed output"
      (cd "$dir" && DIRENV_LOG_FORMAT= direnv exec . python3 -c 'import os,sys; u=os.environ.get("DATABASE_URL",""); sys.exit(0 if "&" in u and "ep-bitter-water-b4hhptwl" in u else 1)')
    }
    run_exec "$wt"
    run_exec "$wt/web"
    (cd "$wt" && bash scripts/worktree-setup.sh)
    main_unchanged "$main_before"
    ;;

  *)
    die "unknown subcommand: $command_name"
    ;;
esac

echo "worktree-selftest: $command_name passed"
