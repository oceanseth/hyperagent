#!/usr/bin/env bash
# Self-checks for the Supabase Prisma port. Prints check names only.
# Never shell-source web/.env.local (connection strings contain '&').
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
mode=${1:-}
if [[ -z "$mode" ]]; then
  echo "FAIL usage" >&2
  exit 2
fi

run_node() {
  (cd "$root/web" && node_modules/.bin/dotenv -e .env.local -- "$@")
}

case "$mode" in
  schema)
    (cd "$root/web" && pnpm install --frozen-lockfile --offline)
    run_node node scripts/supabase-schema.mjs
    ;;
  migrate)
    run_node node scripts/supabase-migrate.mjs
    ;;
  rls)
    run_node node --import tsx scripts/supabase-rls.ts
    ;;
  isolation)
    run_node node --import tsx scripts/supabase-isolation.ts
    ;;
  http)
    if [[ "${SAIDA_DB_MODE:-}" != "supabase" ]]; then
      echo "FAIL db-mode"
      exit 1
    fi
    if [[ -z "${HYPERAGENT_URL:-}" ]]; then
      echo "FAIL missing-url"
      exit 1
    fi
    base=${HYPERAGENT_URL%/}
    work=$(mktemp -d)
    chmod 700 "$work"
    jar1=$work/j1 jar2=$work/j2 jar3=$work/j3
    cleanup_http() {
      if [[ -f "$jar1" || -f "$jar2" || -f "$jar3" ]]; then
        run_node node --import tsx scripts/supabase-http-cleanup.ts "$jar1" "$jar2" "$jar3" || true
      fi
      rm -rf "$work"
    }
    trap cleanup_http EXIT
    body=$work/body
    code_file=$work/status
    note_id=$(python3 -c 'import uuid; print(uuid.uuid4())')
    fetch() {
      local jar=$1 method=$2 path=$3
      shift 3
      curl -sS -o "$body" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$base$path" "$@" > "$code_file"
    }
    fetch "$jar1" GET /api/canvas
    python3 - "$body" "$code_file" << 'PY'
import json, sys
body, status = sys.argv[1:]
ok = open(status).read().strip() == "200" and "stacks" in json.load(open(body))
print("PASS canvas-jar-1" if ok else "FAIL canvas-jar-1")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar2" GET /api/canvas
    python3 - "$body" "$code_file" "$jar1" "$jar2" << 'PY'
import json, sys
body, status, jar1, jar2 = sys.argv[1:]
def workspace(path):
    for line in open(path):
        if "phab-workspace" in line:
            parts = line.split()
            return parts[-1]
    return ""
ok = open(status).read().strip() == "200" and "stacks" in json.load(open(body))
distinct = workspace(jar1) and workspace(jar1) != workspace(jar2)
print("PASS canvas-jar-2" if ok and distinct else "FAIL canvas-jar-2")
raise SystemExit(0 if ok and distinct else 1)
PY
    fetch "$jar1" POST /api/notes -H "Origin: $base" -H 'Content-Type: application/json' \
      --data "{\"action\":\"upsert\",\"note\":{\"id\":\"$note_id\",\"label\":\"Selftest\",\"body\":\"http-note\",\"x\":1,\"y\":2}}"
    python3 - "$code_file" << 'PY'
import sys
ok = open(sys.argv[1]).read().strip() == "200"
print("PASS save-note" if ok else "FAIL save-note")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar1" GET /api/canvas
    python3 - "$body" << 'PY'
import json, sys
notes = json.load(open(sys.argv[1])).get("notes") or []
ok = any(note.get("body") == "http-note" for note in notes)
print("PASS note-visible" if ok else "FAIL note-visible")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar2" GET /api/canvas
    python3 - "$body" << 'PY'
import json, sys
notes = json.load(open(sys.argv[1])).get("notes") or []
ok = all(note.get("body") != "http-note" for note in notes)
print("PASS note-isolated" if ok else "FAIL note-isolated")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar1" POST /api/layout -H "Origin: $base" -H 'Content-Type: application/json' \
      --data '{"positions":{"card":{"x":5,"y":6}}}'
    fetch "$jar1" GET /api/canvas
    python3 - "$body" "$code_file" << 'PY'
import json, sys
body, status = sys.argv[1:]
canvas = json.load(open(body))
pos = (canvas.get("positions") or {}).get("card") or {}
ok = open(status).read().strip() == "200" and pos.get("x") == 5 and pos.get("y") == 6
print("PASS layout" if ok else "FAIL layout")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar1" POST /api/share -H "Origin: $base" -H 'Content-Type: application/json' \
      --data '{"action":"create","title":"HTTP selftest board"}'
    python3 - "$body" "$code_file" "$work/share.json" << 'PY'
import json, sys
body, status, dest = sys.argv[1:]
data = json.load(open(body))
ok = open(status).read().strip() == "200" and data.get("code") and data.get("title")
json.dump({"code": data.get("code", ""), "title": data.get("title", "")}, open(dest, "w"))
print("PASS share-create" if ok else "FAIL share-create")
raise SystemExit(0 if ok else 1)
PY
    share_code=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["code"])' "$work/share.json")
    share_title=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$work/share.json")
    curl -sS -o "$body" -w '%{http_code}' "$base/s/$share_code" > "$code_file"
    python3 - "$body" "$code_file" "$share_title" << 'PY'
import sys
body, status, title = sys.argv[1:]
html = open(body).read()
ok = open(status).read().strip() == "200" and title in html and "og:title" in html
print("PASS share-page" if ok else "FAIL share-page")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar3" POST /api/share -H "Origin: $base" -H 'Content-Type: application/json' \
      --data "{\"action\":\"join\",\"code\":\"$share_code\"}"
    fetch "$jar3" GET /api/canvas
    python3 - "$body" "$code_file" << 'PY'
import json, sys
body, status = sys.argv[1:]
notes = json.load(open(body)).get("notes") or []
ok = open(status).read().strip() == "200" and any(note.get("body") == "http-note" for note in notes)
print("PASS join" if ok else "FAIL join")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar2" POST /api/share -H "Origin: $base" -H 'Content-Type: application/json' \
      --data "{\"action\":\"rename\",\"title\":\"Hijack\",\"code\":\"$share_code\"}"
    python3 - "$code_file" << 'PY'
import sys
ok = open(sys.argv[1]).read().strip() != "200"
print("PASS rename-blocked" if ok else "FAIL rename-blocked")
raise SystemExit(0 if ok else 1)
PY
    fetch "$jar1" GET /api/canvas
    python3 - "$body" "$share_title" << 'PY'
import json, sys
title = json.load(open(sys.argv[1])).get("boardTitle")
ok = title == sys.argv[2]
print("PASS title-unchanged" if ok else "FAIL title-unchanged")
raise SystemExit(0 if ok else 1)
PY
    curl -sS -o "$body" -w '%{http_code}' "$base/api/workspaces" > "$code_file"
    python3 - "$body" "$code_file" << 'PY'
import json, sys
ok = open(sys.argv[2]).read().strip() == "401"
try:
    json.load(open(sys.argv[1]))
except Exception:
    ok = False
print("PASS workspaces-unauthorized" if ok else "FAIL workspaces-unauthorized")
raise SystemExit(0 if ok else 1)
PY
    curl -sS -o "$body" -w '%{http_code}' "$base/boards" > "$code_file"
    python3 - "$code_file" << 'PY'
import sys
ok = open(sys.argv[1]).read().strip() == "200"
print("PASS boards-page" if ok else "FAIL boards-page")
raise SystemExit(0 if ok else 1)
PY
    for jar in "$jar1" "$jar2" "$jar3"; do
      curl -sS -o /dev/null -b "$jar" -c "$jar" -X POST -H "Origin: $base" "$base/api/clear" || true
    done
    echo "PASS clear"
    ;;
  built)
    port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
    log=$root/.gc-env/built-selftest.log
    mkdir -p "$root/.gc-env"
    (cd "$root/web" && HOST=127.0.0.1 PORT="$port" node_modules/.bin/dotenv -e .env.local -- node .output/server/index.mjs > "$log" 2>&1) &
    server=$!
    trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true' EXIT
    ok=0
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if curl -fsS -o "$log.body" "http://127.0.0.1:$port/api/canvas" 2>/dev/null && python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); assert "stacks" in data' "$log.body"; then
        ok=1
        break
      fi
      sleep 1
    done
    rm -f "$log.body"
    if [[ "$ok" == 1 ]]; then
      echo "PASS built-canvas"
    else
      echo "FAIL built-canvas"
      exit 1
    fi
    ;;
  *)
    echo "FAIL unknown-mode"
    exit 2
    ;;
esac
