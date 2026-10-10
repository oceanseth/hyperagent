#!/usr/bin/env bash
# supabase-dev-split.sh — idempotent setup/cutover for the dev Supabase split.
#
# Gives dev.hyperagent.lol its own Supabase project (hyperagent-dev) so dev
# stops sharing the production project. Full runbook and rationale:
# docs/SUPABASE_DEV_SPLIT.md. Every stage checks before it acts, so re-running
# converges with no duplicates.
#
# HARD RULES (enforced below — see guards):
#   - NEVER touches Supabase project srtrucncutffceakivux (prod). Read-only
#     listing only; every mutating call asserts the target ref differs.
#   - NEVER touches App Runner service hyperagent-app (prod). The dev ARN is
#     hard-coded and the service name is re-asserted from describe-service.
#   - NEVER touches Fly (no fly/flyctl commands exist in this script).
#   - NEVER writes to OpenBao kv/shared/supabase (prod secrets; read-only
#     gate check only). Dev secrets go to kv/shared/supabase-dev.
#   - NEVER prints secret values. Output is check names/statuses only, in the
#     style of scripts/supabase-selftest.sh.
#
# Usage:
#   scripts/supabase-dev-split.sh                 # run all stages in order
#   scripts/supabase-dev-split.sh --stage <name>  # run one stage
#   Stages: gate project auth secrets migrate apprunner ci-vars verify
#
# stage_apprunner reads SUPABASE_DATABASE_URL, SUPABASE_DIRECT_URL, and
# SUPABASE_PUBLISHABLE_KEY from the environment when all three are set
# (GitHub Actions OIDC path). Otherwise it reads kv/shared/supabase-dev.
#
# stage_verify crawls JS chunks. VERIFY_DEV_ORIGIN and VERIFY_PROD_ORIGIN
# override the two site origins for a local fixture; when either is set the
# App Runner status read is skipped.
#
# Token: reads SUPABASE_ACCESS_TOKEN from the environment, else from OpenBao
# kv/shared/supabase (AppRole creds from ~/.config/hyperagent/fable-bao-dolt.env).
# If neither exists the gate stage fails fast and nothing is changed.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

# ---------------------------------------------------------------- constants
PROD_REF='srtrucncutffceakivux'                      # prod Supabase ref — never a mutation target
DEV_PROJECT_NAME='hyperagent-dev'
SUPABASE_REGION='us-east-1'
MGMT_API='https://api.supabase.com'
SITE_URL='https://dev.hyperagent.lol'
ALLOW_ENTRY='https://dev.hyperagent.lol/**'
DEV_ARN='arn:aws:apprunner:us-east-1:218827615080:service/hyperagent-app-dev/a45352f0a17e499389db9bdc8b644d5b'
AWS_REGION='us-east-1'
GH_REPO='oceanseth/hyperagent'
BAO_ENV_FILE="${BAO_ENV_FILE:-${SAIDA_BAO_CREDS:-$HOME/.config/hyperagent/fable-bao-dolt.env}}"
if [[ ! -f "$BAO_ENV_FILE" && -f "$HOME/.config/goosey/openbao.env" ]]; then
  BAO_ENV_FILE="$HOME/.config/goosey/openbao.env"
fi
BAO_NS_DEFAULT='hyperagent'
KV_PROD_PATH='shared/supabase'       # READ-ONLY
KV_DEV_PATH='shared/supabase-dev'    # the only OpenBao path this script writes

# apprunner before ci-vars: a failed server cutover must not publish
# DEV_SUPABASE_* or the next dev image bakes the new project while the
# server still reads production.
ALL_STAGES=(gate project auth secrets migrate apprunner ci-vars verify)

# ---------------------------------------------------------------- plumbing
workdir=$(mktemp -d)
chmod 700 "$workdir"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

pass() { echo "PASS $*"; }
skip() { echo "SKIP $*"; }
note() { echo "NOTE $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }

# Print an API error message with long tokens stripped. Never print the raw body.
api_error() {
  node -e '
    const fs = require("fs");
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(0); }
    const msg = d.message || d.error || d.msg || d.error_description || "";
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    process.stdout.write(String(text).replace(/[A-Za-z0-9_+/=-]{24,}/g, "[redacted]").slice(0, 300));
  ' "$1" 2>/dev/null || true
}

require() {
  local t
  for t in "$@"; do
    command -v "$t" >/dev/null 2>&1 || fail "missing-tool $t (install it and re-run)"
  done
}
require curl node

# jget <json-file> <js expression over `d`> — prints the value, exit 3 if null/undefined.
jget() {
  node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let v;
    try { v = new Function("d", "return (" + process.argv[2] + ")")(d); }
    catch (e) { process.exit(3); }
    if (v === undefined || v === null) process.exit(3);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  ' "$1" "$2"
}

# jq-free JSON object builder: jbuild <out-file> KEY=VALUE...  (values as strings)
jbuild() {
  local out=$1; shift
  node -e '
    const fs = require("fs");
    const o = {};
    for (const kv of process.argv.slice(2)) {
      const i = kv.indexOf("=");
      o[kv.slice(0, i)] = kv.slice(i + 1);
    }
    fs.writeFileSync(process.argv[1], JSON.stringify(o));
  ' "$out" "$@"
}

winpath() { # aws cli on Windows needs a Windows-style path for file://
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
}

# ---------------------------------------------------------------- OpenBao
BAO_TOKEN=''

bao_login() {
  [[ -n "$BAO_TOKEN" ]] && return 0
  [[ -f "$BAO_ENV_FILE" ]] || fail "gate OpenBao env file not found at $BAO_ENV_FILE and SUPABASE_ACCESS_TOKEN is not in the environment. Nothing was changed."
  # shellcheck disable=SC1090
  set -a; . "$BAO_ENV_FILE"; set +a
  [[ -n "${BAO_ADDR:-}" && -n "${BAO_ROLE_ID:-}" && -n "${BAO_SECRET_ID:-}" ]] \
    || fail "gate OpenBao env file is missing BAO_ADDR/BAO_ROLE_ID/BAO_SECRET_ID"
  local login_path="${BAO_LOGIN_PATH:-auth/approle/login}"
  jbuild "$workdir/bao-login.json" "role_id=$BAO_ROLE_ID" "secret_id=$BAO_SECRET_ID"
  local code
  code=$(curl -sS -o "$workdir/bao-resp.json" -w '%{http_code}' \
    -H "X-Vault-Namespace: ${BAO_NAMESPACE:-$BAO_NS_DEFAULT}" \
    -H 'Content-Type: application/json' \
    --data @"$workdir/bao-login.json" \
    "$BAO_ADDR/v1/$login_path")
  rm -f "$workdir/bao-login.json"
  [[ "$code" == 200 ]] || fail "gate OpenBao AppRole login returned HTTP $code"
  BAO_TOKEN=$(jget "$workdir/bao-resp.json" 'd.auth.client_token') \
    || fail "gate OpenBao login response had no client_token"
  printf 'X-Vault-Token: %s' "$BAO_TOKEN" > "$workdir/bao.h"
  printf '\nX-Vault-Namespace: %s' "${BAO_NAMESPACE:-$BAO_NS_DEFAULT}" >> "$workdir/bao.h"
}

# bao_kv_get <subpath> <out-file>; echoes HTTP code; .data.data in out-file on 200
bao_kv_get() {
  bao_login
  curl -sS -o "$2" -w '%{http_code}' -H @"$workdir/bao.h" \
    "$BAO_ADDR/v1/kv/data/$1"
}

# bao_kv_put_dev <json-file with {"data":{...}}> — the ONLY write path; dev only.
bao_kv_put_dev() {
  bao_login
  local code
  code=$(curl -sS -o "$workdir/bao-put-resp.json" -w '%{http_code}' \
    -H @"$workdir/bao.h" -H 'Content-Type: application/json' \
    --data @"$1" "$BAO_ADDR/v1/kv/data/$KV_DEV_PATH")
  [[ "$code" == 200 || "$code" == 204 ]] || fail "secrets OpenBao write to kv/$KV_DEV_PATH returned HTTP $code"
}

# ------------------------------------------------------ Supabase management
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
REF=''

ensure_token() {
  [[ -n "$SUPABASE_ACCESS_TOKEN" ]] && { ensure_auth_header; return 0; }
  local code
  code=$(bao_kv_get "$KV_PROD_PATH" "$workdir/kv-prod.json")
  [[ "$code" == 200 ]] || fail "gate OpenBao read of kv/$KV_PROD_PATH returned HTTP $code"
  if SUPABASE_ACCESS_TOKEN=$(jget "$workdir/kv-prod.json" 'd.data.data.SUPABASE_ACCESS_TOKEN'); then
    ensure_auth_header
  else
    fail "gate SUPABASE_ACCESS_TOKEN is not in the environment and not in OpenBao kv/$KV_PROD_PATH. Waiting on lou to drop SUPABASE_ACCESS_TOKEN into kv/shared/supabase. Nothing was changed."
  fi
  rm -f "$workdir/kv-prod.json"
}

ensure_auth_header() {
  printf 'Authorization: Bearer %s' "$SUPABASE_ACCESS_TOKEN" > "$workdir/mgmt.h"
}

# mgmt <METHOD> <path> [json-data-file] — body into $workdir/resp.json, echoes HTTP code.
mgmt() {
  local method=$1 path=$2 datafile=${3:-}
  if [[ "$method" != GET && "$path" == *"$PROD_REF"* ]]; then
    fail "guard refusing mutating management call against prod project ($method $path)"
  fi
  local args=(-sS -o "$workdir/resp.json" -w '%{http_code}' -X "$method" -H @"$workdir/mgmt.h")
  if [[ -n "$datafile" ]]; then
    args+=(-H 'Content-Type: application/json' --data @"$datafile")
  fi
  curl "${args[@]}" "$MGMT_API$path"
}

assert_dev_ref() {
  [[ -n "$REF" ]] || fail "guard dev project ref is empty"
  [[ "$REF" != "$PROD_REF" ]] || fail "guard dev project ref equals the PROD ref ($PROD_REF) — aborting"
}

# Look up the hyperagent-dev ref from the projects list; empty REF if absent.
lookup_ref() {
  ensure_token
  local code
  code=$(mgmt GET /v1/projects)
  [[ "$code" == 200 ]] || fail "project GET /v1/projects returned HTTP $code"
  cp "$workdir/resp.json" "$workdir/projects.json"
  # `id` is deprecated and documented as distinct from `ref`. Always use ref.
  if REF=$(jget "$workdir/projects.json" "(() => { const p = d.find(x => x.name === '$DEV_PROJECT_NAME'); return p ? (p.ref || p.id) : null; })()"); then
    assert_dev_ref
  else
    REF=''
  fi
}

ensure_ref() {
  [[ -n "$REF" ]] && return 0
  lookup_ref
  [[ -n "$REF" ]] || fail "project $DEV_PROJECT_NAME does not exist yet — run the 'project' stage first"
}

# ------------------------------------------------------- kv/supabase-dev I/O
# Reads current dev secret into $workdir/kv-dev.json (".data.data" object or {}).
read_dev_kv() {
  local code
  code=$(bao_kv_get "$KV_DEV_PATH" "$workdir/kv-dev-raw.json")
  if [[ "$code" == 200 ]]; then
    jget "$workdir/kv-dev-raw.json" 'd.data.data' > "$workdir/kv-dev.json" || echo '{}' > "$workdir/kv-dev.json"
  elif [[ "$code" == 404 ]]; then
    echo '{}' > "$workdir/kv-dev.json"
  else
    fail "secrets OpenBao read of kv/$KV_DEV_PATH returned HTTP $code"
  fi
}

dev_kv_value() { # dev_kv_value <KEY>  (exit 3 if absent)
  jget "$workdir/kv-dev.json" "d['$1']"
}

# merge_put_dev_kv KEY=VALUE... — merge keys into kv/shared/supabase-dev
merge_put_dev_kv() {
  read_dev_kv
  node -e '
    const fs = require("fs");
    const cur = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const kv of process.argv.slice(3)) {
      const i = kv.indexOf("=");
      cur[kv.slice(0, i)] = kv.slice(i + 1);
    }
    fs.writeFileSync(process.argv[2], JSON.stringify({ data: cur }));
  ' "$workdir/kv-dev.json" "$workdir/kv-dev-put.json" "$@"
  bao_kv_put_dev "$workdir/kv-dev-put.json"
  rm -f "$workdir/kv-dev-put.json"
  read_dev_kv
}

# ---------------------------------------------------------------- stages
stage_gate() {
  ensure_token
  local code
  code=$(mgmt GET /v1/organizations)
  [[ "$code" == 200 ]] || fail "gate GET /v1/organizations returned HTTP $code (token invalid or expired?)"
  pass gate
}

stage_project() {
  lookup_ref
  if [[ -n "$REF" ]]; then
    skip "project $DEV_PROJECT_NAME already exists"
  else
    # Pick the org: the one that owns the prod project, else the only org.
    local code org
    code=$(mgmt GET /v1/organizations)
    [[ "$code" == 200 ]] || fail "project GET /v1/organizations returned HTTP $code"
    cp "$workdir/resp.json" "$workdir/orgs.json"
    if org=$(jget "$workdir/projects.json" "d.find(p => (p.ref || p.id) === '$PROD_REF')?.organization_slug"); then
      :
    elif org=$(jget "$workdir/orgs.json" 'd.length === 1 ? (d[0].slug || d[0].id) : null'); then
      :
    else
      fail "project could not pick an organization (several orgs, none owning $PROD_REF)"
    fi
    note "project creating $DEV_PROJECT_NAME in org (id withheld) region $SUPABASE_REGION"

    # Alphanumeric-only password (it is embedded in connection strings).
    local pw
    pw=$(node -e '
      const c = require("crypto");
      let s = "";
      while (s.length < 32) s += c.randomBytes(48).toString("base64").replace(/[^A-Za-z0-9]/g, "");
      process.stdout.write(s.slice(0, 32));
    ')
    [[ ${#pw} -eq 32 ]] || fail "project password generation failed"
    # Store the password BEFORE using it, so it is never only in shell memory.
    merge_put_dev_kv "SUPABASE_DB_PASSWORD=$pw"
    note "project db password stored in OpenBao kv/$KV_DEV_PATH"

    node -e '
      const fs = require("fs");
      fs.writeFileSync(process.argv[1], JSON.stringify({
        name: process.argv[2],
        organization_slug: process.argv[3],
        db_pass: process.argv[5],
        region_selection: { type: "specific", code: process.argv[4] },
      }));
    ' "$workdir/create.json" "$DEV_PROJECT_NAME" "$org" "$SUPABASE_REGION" "$pw"
    code=$(mgmt POST /v1/projects "$workdir/create.json")
    rm -f "$workdir/create.json"
    [[ "$code" == 200 || "$code" == 201 ]] || fail "project POST /v1/projects returned HTTP $code ($(api_error "$workdir/resp.json"))"
    REF=$(jget "$workdir/resp.json" 'd.ref || d.id') || fail "project create response had no ref"
    assert_dev_ref
    note "project created, ref recorded"
  fi
  assert_dev_ref

  # Wait for ACTIVE_HEALTHY.
  local tries status=''
  for tries in $(seq 1 60); do
    if [[ $(mgmt GET "/v1/projects/$REF") == 200 ]]; then
      status=$(jget "$workdir/resp.json" 'd.status') || status=''
      [[ "$status" == ACTIVE_HEALTHY ]] && break
    fi
    note "project status ${status:-unknown}; waiting (attempt $tries/60)"
    sleep 10
  done
  [[ "$status" == ACTIVE_HEALTHY ]] || fail "project did not reach ACTIVE_HEALTHY"
  pass project
}

stage_auth() {
  ensure_ref
  local code
  code=$(mgmt GET "/v1/projects/$REF/config/auth")
  [[ "$code" == 200 ]] || fail "auth GET config/auth returned HTTP $code"
  cp "$workdir/resp.json" "$workdir/auth.json"

  local site allow email
  site=$(jget "$workdir/auth.json" 'd.site_url') || site=''
  allow=$(jget "$workdir/auth.json" 'd.uri_allow_list') || allow=''
  email=$(jget "$workdir/auth.json" 'd.external_email_enabled') || email=''

  local -a patch=()
  [[ "$site" == "$SITE_URL" ]] || patch+=("site_url=$SITE_URL")
  if [[ ",$allow," != *",$ALLOW_ENTRY,"* ]]; then
    if [[ -n "$allow" ]]; then
      patch+=("uri_allow_list=$allow,$ALLOW_ENTRY")
    else
      patch+=("uri_allow_list=$ALLOW_ENTRY")
    fi
  fi
  if [[ "$email" != true ]]; then
    # external_email_enabled must be a JSON boolean; handled below.
    patch+=("__email__=1")
  fi

  if [[ ${#patch[@]} -eq 0 ]]; then
    skip "auth already configured (site_url + redirect allowlist + email)"
  else
    node -e '
      const fs = require("fs");
      const o = {};
      for (const kv of process.argv.slice(2)) {
        const i = kv.indexOf("=");
        const k = kv.slice(0, i), v = kv.slice(i + 1);
        if (k === "__email__") o.external_email_enabled = true;
        else o[k] = v;
      }
      fs.writeFileSync(process.argv[1], JSON.stringify(o));
    ' "$workdir/auth-patch.json" "${patch[@]}"
    code=$(mgmt PATCH "/v1/projects/$REF/config/auth" "$workdir/auth-patch.json")
    [[ "$code" == 200 ]] || fail "auth PATCH config/auth returned HTTP $code"
  fi
  note "auth GitHub provider SKIPPED on purpose: no OAuth app credentials exist and the app has no signInWithOAuth call (docs/SUPABASE_DEV_SPLIT.md step 4b has the enable recipe if creds appear)"
  pass auth
}

stage_secrets() {
  ensure_ref
  read_dev_kv

  local -a puts=()
  local have_url have_pub have_srv have_db have_direct have_ref pw

  dev_kv_value SUPABASE_PROJECT_REF >/dev/null 2>&1 && have_ref=1 || have_ref=0
  dev_kv_value SUPABASE_URL          >/dev/null 2>&1 && have_url=1 || have_url=0
  dev_kv_value SUPABASE_PUBLISHABLE_KEY >/dev/null 2>&1 && have_pub=1 || have_pub=0
  dev_kv_value SUPABASE_SERVICE_ROLE_KEY >/dev/null 2>&1 && have_srv=1 || have_srv=0
  dev_kv_value SUPABASE_DATABASE_URL >/dev/null 2>&1 && have_db=1 || have_db=0
  dev_kv_value SUPABASE_DIRECT_URL   >/dev/null 2>&1 && have_direct=1 || have_direct=0

  [[ $have_ref == 1 ]] || puts+=("SUPABASE_PROJECT_REF=$REF")
  [[ $have_url == 1 ]] || puts+=("SUPABASE_URL=https://$REF.supabase.co")

  if [[ $have_pub == 0 || $have_srv == 0 ]]; then
    local code
    code=$(mgmt GET "/v1/projects/$REF/api-keys?reveal=true")
    [[ "$code" == 200 ]] || fail "secrets GET api-keys returned HTTP $code"
    cp "$workdir/resp.json" "$workdir/keys.json"
    local pub srv
    # Prefer the current sb_publishable_/sb_secret_ keys. A single find()
    # would hit the legacy anon/service_role JWTs first because they share
    # the name fallback.
    pub=$(jget "$workdir/keys.json" 'd.find(k => (k.api_key || "").startsWith("sb_publishable_"))?.api_key || d.find(k => k.type === "publishable")?.api_key || d.find(k => k.name === "anon")?.api_key') \
      || fail "secrets no publishable key in api-keys response (check $MGMT_API/api/v1-json)"
    srv=$(jget "$workdir/keys.json" 'd.find(k => (k.api_key || "").startsWith("sb_secret_"))?.api_key || d.find(k => k.type === "secret")?.api_key || d.find(k => k.name === "service_role")?.api_key') \
      || fail "secrets no secret/service_role key in api-keys response (check $MGMT_API/api/v1-json)"
    rm -f "$workdir/keys.json"
    [[ $have_pub == 1 ]] || puts+=("SUPABASE_PUBLISHABLE_KEY=$pub")
    [[ $have_srv == 1 ]] || puts+=("SUPABASE_SERVICE_ROLE_KEY=$srv")
  fi

  if [[ $have_db == 0 || $have_direct == 0 ]]; then
    pw=$(dev_kv_value SUPABASE_DB_PASSWORD) \
      || fail "secrets SUPABASE_DB_PASSWORD missing from kv/$KV_DEV_PATH and the management API cannot reveal it; reset the DB password in the dashboard and store it there, then re-run"
    [[ "$pw" =~ ^[A-Za-z0-9]+$ ]] || fail "secrets stored DB password is not alphanumeric; it cannot be embedded in a connection string safely"
    local code host tx_host sess_host tx_port sess_port tx_user sess_user
    code=$(mgmt GET "/v1/projects/$REF/config/database/pooler")
    [[ "$code" == 200 ]] || fail "secrets GET config/database/pooler returned HTTP $code ($(api_error "$workdir/resp.json"))"
    # Supavisor may return only the transaction pooler (port 6543). Session
    # mode for migrations is the same host on port 5432; new projects' direct
    # db host is IPv6-only, so do not invent db.<ref>.supabase.co.
    read -r tx_host tx_port tx_user sess_host sess_port sess_user < <(node -e '
      const fs = require("fs");
      const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const rows = Array.isArray(d) ? d : [d];
      const tx = rows.find(x => x.pool_mode === "transaction") || rows.find(x => Number(x.db_port) === 6543);
      if (!tx || !tx.db_host) process.exit(3);
      const sess = rows.find(x => x.pool_mode === "session") || rows.find(x => Number(x.db_port) === 5432);
      const user = (row) => (row && row.db_user) || "";
      process.stdout.write([
        tx.db_host, tx.db_port, user(tx),
        sess ? sess.db_host : tx.db_host,
        sess ? sess.db_port : 5432,
        sess ? user(sess) : user(tx),
      ].join(" ") + "\n");
    ' "$workdir/resp.json") || fail "secrets could not determine the transaction pooler endpoint"
    [[ "$tx_host" == *pooler.supabase.com && "$sess_host" == *pooler.supabase.com ]] || fail "secrets pooler host looks wrong (not *.pooler.supabase.com)"
    [[ "$tx_port" == 6543 && "$sess_port" == 5432 ]] || fail "secrets pooler ports are not 6543/5432"
    local tx_user_ok=${tx_user:-postgres.$REF}
    local sess_user_ok=${sess_user:-postgres.$REF}
    [[ "$tx_user_ok" == postgres.$REF && "$sess_user_ok" == postgres.$REF ]] || fail "secrets pooler user is not postgres.<dev-ref>"
    local db_url="postgresql://${tx_user_ok}:$pw@${tx_host}:${tx_port}/postgres?pgbouncer=true"
    local direct_url="postgresql://${sess_user_ok}:$pw@${sess_host}:${sess_port}/postgres"
    [[ "$db_url" != *"$PROD_REF"* ]] || fail "guard constructed URL references the prod project"
    [[ $have_db == 1 ]] || puts+=("SUPABASE_DATABASE_URL=$db_url")
    [[ $have_direct == 1 ]] || puts+=("SUPABASE_DIRECT_URL=$direct_url")
  fi

  if [[ ${#puts[@]} -eq 0 ]]; then
    skip "secrets kv/$KV_DEV_PATH already has all keys"
  else
    merge_put_dev_kv "${puts[@]}"
    note "secrets wrote ${#puts[@]} missing key(s) to kv/$KV_DEV_PATH (names only: ${puts[*]%%=*})"
  fi
  pass secrets
}

stage_migrate() {
  ensure_ref
  require pnpm
  read_dev_kv
  local db_url direct_url
  db_url=$(dev_kv_value SUPABASE_DATABASE_URL) || fail "migrate SUPABASE_DATABASE_URL missing from kv/$KV_DEV_PATH — run the 'secrets' stage first"
  direct_url=$(dev_kv_value SUPABASE_DIRECT_URL) || fail "migrate SUPABASE_DIRECT_URL missing from kv/$KV_DEV_PATH — run the 'secrets' stage first"
  [[ "$db_url" == *"$REF"* && "$direct_url" == *"$REF"* ]] || fail "guard migrate URLs do not reference the dev project ref"
  [[ "$db_url" != *"$PROD_REF"* && "$direct_url" != *"$PROD_REF"* ]] || fail "guard migrate URLs reference the PROD project — aborting"

  (
    cd "$root/web"
    [[ -d node_modules ]] || pnpm install --frozen-lockfile
    env SUPABASE_DATABASE_URL="$db_url" SUPABASE_DIRECT_URL="$direct_url" \
      pnpm exec prisma migrate deploy
  )
  pass migrate
}

stage_ci_vars() {
  ensure_ref
  require gh
  read_dev_kv
  local pub
  pub=$(dev_kv_value SUPABASE_PUBLISHABLE_KEY) || fail "ci-vars SUPABASE_PUBLISHABLE_KEY missing from kv/$KV_DEV_PATH — run the 'secrets' stage first"
  # Both values are public by design (baked into the browser bundle).
  gh variable set DEV_SUPABASE_URL --repo "$GH_REPO" --body "https://$REF.supabase.co"
  gh variable set DEV_SUPABASE_KEY --repo "$GH_REPO" --body "$pub"
  note "ci-vars set repo variables DEV_SUPABASE_URL / DEV_SUPABASE_KEY on $GH_REPO; the next deploy-dev run bakes them into the dev bundle"
  pass ci-vars
}

stage_apprunner() {
  require aws
  # Guards: dev ARN only, never the prod service.
  [[ "$DEV_ARN" == *":service/hyperagent-app-dev/"* ]] || fail "guard DEV_ARN is not the hyperagent-app-dev service"
  [[ "$DEV_ARN" != *":service/hyperagent-app/"* ]] || fail "guard DEV_ARN is the PROD service — aborting"

  local db_url direct_url pub
  if [[ -n "${SUPABASE_DATABASE_URL:-}" || -n "${SUPABASE_DIRECT_URL:-}" || -n "${SUPABASE_PUBLISHABLE_KEY:-}" ]]; then
    [[ -n "${SUPABASE_DATABASE_URL:-}" && -n "${SUPABASE_DIRECT_URL:-}" && -n "${SUPABASE_PUBLISHABLE_KEY:-}" ]] \
      || fail "apprunner partial SUPABASE_DATABASE_URL / SUPABASE_DIRECT_URL / SUPABASE_PUBLISHABLE_KEY in the environment"
    db_url=$SUPABASE_DATABASE_URL
    direct_url=$SUPABASE_DIRECT_URL
    pub=$SUPABASE_PUBLISHABLE_KEY
    REF=$(node -e '
      const u = process.env.SUPABASE_DATABASE_URL || "";
      const m = u.match(/postgres\.([a-z0-9]{15,})/);
      if (!m) process.exit(3);
      process.stdout.write(m[1]);
    ') || fail "apprunner SUPABASE_DATABASE_URL has no postgres.<ref> user"
    assert_dev_ref
    note "apprunner using connection values from the environment (ref $REF)"
  else
    ensure_ref
    read_dev_kv
    db_url=$(dev_kv_value SUPABASE_DATABASE_URL) || fail "apprunner SUPABASE_DATABASE_URL missing from kv/$KV_DEV_PATH"
    direct_url=$(dev_kv_value SUPABASE_DIRECT_URL) || fail "apprunner SUPABASE_DIRECT_URL missing from kv/$KV_DEV_PATH"
    pub=$(dev_kv_value SUPABASE_PUBLISHABLE_KEY) || fail "apprunner SUPABASE_PUBLISHABLE_KEY missing from kv/$KV_DEV_PATH"
  fi
  [[ "$db_url" == *"$REF"* && "$direct_url" == *"$REF"* ]] || fail "guard apprunner URLs do not reference the dev project ref"
  [[ "$db_url" != *"$PROD_REF"* && "$direct_url" != *"$PROD_REF"* && "$pub" != *"$PROD_REF"* ]] || fail "guard desired URLs reference the PROD project — aborting"

  aws apprunner describe-service --region "$AWS_REGION" --service-arn "$DEV_ARN" \
    --output json > "$workdir/svc.json"
  local name
  name=$(jget "$workdir/svc.json" 'd.Service.ServiceName') || fail "apprunner describe-service gave no ServiceName"
  [[ "$name" == hyperagent-app-dev ]] || fail "guard describe-service returned '$name', expected hyperagent-app-dev — aborting"

  # Compare current env to desired; write new SourceConfiguration only if drifted.
  local drift
  drift=$(node -e '
    const fs = require("fs");
    const [svcFile, outFile, dbUrl, directUrl, supaUrl, supaKey] = process.argv.slice(1);
    const svc = JSON.parse(fs.readFileSync(svcFile, "utf8"));
    const sc = svc.Service.SourceConfiguration;
    const envs = sc.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables || {};
    const want = {
      SUPABASE_DATABASE_URL: dbUrl,
      SUPABASE_DIRECT_URL: directUrl,
      SUPABASE_URL: supaUrl,
      SUPABASE_KEY: supaKey,
    };
    let drift = false;
    for (const [k, v] of Object.entries(want)) {
      if (envs[k] !== v) { envs[k] = v; drift = true; }
    }
    sc.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables = envs;
    fs.writeFileSync(outFile, JSON.stringify(sc));
    process.stdout.write(drift ? "yes" : "no");
  ' "$workdir/svc.json" "$workdir/sc.json" \
    "$db_url" "$direct_url" "https://$REF.supabase.co" "$pub")

  if [[ "$drift" == no ]]; then
    skip "apprunner dev service env already points at $DEV_PROJECT_NAME"
  else
    note "apprunner updating dev service env (SUPABASE_DATABASE_URL, SUPABASE_DIRECT_URL, SUPABASE_URL, SUPABASE_KEY)"
    aws apprunner update-service --region "$AWS_REGION" --service-arn "$DEV_ARN" \
      --source-configuration "file://$(winpath "$workdir/sc.json")" \
      --output json > "$workdir/update.json"
    rm -f "$workdir/sc.json"
    local tries status=''
    for tries in $(seq 1 60); do
      status=$(aws apprunner describe-service --region "$AWS_REGION" --service-arn "$DEV_ARN" \
        --query Service.Status --output text)
      [[ "$status" == RUNNING ]] && break
      note "apprunner status $status; waiting (attempt $tries/60)"
      sleep 15
    done
    [[ "$status" == RUNNING ]] || fail "apprunner dev service did not return to RUNNING"
  fi
  rm -f "$workdir/svc.json" "$workdir/sc.json"
  pass apprunner
}

# Print "<dev_hits> <prod_hits> <chunk_count>" for the JS bundles a page loads.
# The HTML shell does not contain the Supabase URL. Vite names the lazy
# assets/supabase-*.js chunk from the entry bundle, so follow those references.
bundle_ref_report() {
  local origin=$1 html_file=$2
  node --input-type=module - "$origin" "$html_file" "$REF" "$PROD_REF" <<'JS'
import fs from "fs";
const origin = process.argv[2];
const html = fs.readFileSync(process.argv[3], "utf8");
const devRef = process.argv[4];
const prodRef = process.argv[5];
const originUrl = new URL(origin.endsWith("/") ? origin : origin + "/");
const seen = new Set();
const queue = [];
function enqueue(raw, base) {
  if (!raw) return;
  let url;
  try { url = new URL(raw, base); } catch { return; }
  if (url.origin !== originUrl.origin) return;
  if (!url.pathname.includes("/assets/") || !url.pathname.endsWith(".js")) return;
  const href = url.origin + url.pathname;
  if (seen.has(href)) return;
  seen.add(href);
  queue.push(href);
}
for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.js)["']/g)) {
  enqueue(m[1], originUrl);
}
const texts = [];
const maxChunks = 80;
while (queue.length && texts.length < maxChunks) {
  const href = queue.shift();
  const res = await fetch(href);
  if (!res.ok) {
    console.error(`verify chunk HTTP ${res.status} ${href}`);
    process.exit(2);
  }
  const text = await res.text();
  texts.push(text);
  for (const m of text.matchAll(/(?:assets\/|\.\/)[A-Za-z0-9._-]+\.js/g)) {
    const raw = m[0].startsWith("./") ? m[0] : "/" + m[0];
    const before = queue.length;
    enqueue(raw, href);
    if (queue.length > before && queue[queue.length - 1].includes("/supabase-")) {
      queue.unshift(queue.pop());
    }
  }
}
if (texts.length === 0) {
  console.error("verify page has no /assets/*.js chunks");
  process.exit(2);
}
const all = texts.join("\n");
const count = (ref) => (ref ? all.split(ref).length - 1 : 0);
process.stdout.write(`${count(devRef)} ${count(prodRef)} ${texts.length}`);
JS
}

stage_verify() {
  ensure_ref
  local dev_origin=${VERIFY_DEV_ORIGIN:-$SITE_URL}
  local prod_origin=${VERIFY_PROD_ORIGIN:-https://hyperagent.lol}
  local code report dev_hits prod_hits nchunks
  code=$(curl -sS -o "$workdir/dev.html" -w '%{http_code}' "$dev_origin/") || code=000
  [[ "$code" == 200 ]] || fail "verify $dev_origin/ returned HTTP $code"
  pass verify-dev-up

  report=$(bundle_ref_report "$dev_origin" "$workdir/dev.html") || fail "verify could not read dev JS chunks"
  read -r dev_hits prod_hits nchunks <<<"$report"
  note "verify dev bundle chunks=${nchunks} dev_ref=${dev_hits} prod_ref=${prod_hits}"
  [[ "$prod_hits" == 0 ]] || fail "verify dev bundle still contains the prod project ref (${prod_hits})"
  [[ "$dev_hits" != 0 ]] || fail "verify dev bundle does not contain the dev project ref"

  code=$(curl -sS -o "$workdir/prod.html" -w '%{http_code}' "$prod_origin/") || code=000
  [[ "$code" == 200 ]] || fail "verify $prod_origin/ returned HTTP $code — investigate before proceeding"
  pass verify-prod-up
  report=$(bundle_ref_report "$prod_origin" "$workdir/prod.html") || fail "verify could not read prod JS chunks"
  read -r dev_hits prod_hits nchunks <<<"$report"
  note "verify prod bundle chunks=${nchunks} dev_ref=${dev_hits} prod_ref=${prod_hits}"
  [[ "$dev_hits" == 0 ]] || fail "verify prod bundle contains the dev project ref (${dev_hits})"
  [[ "$prod_hits" != 0 ]] || fail "verify prod bundle does not contain the prod project ref"

  if [[ -n "${VERIFY_DEV_ORIGIN:-}" || -n "${VERIFY_PROD_ORIGIN:-}" ]]; then
    note "verify origin override set; skipped prod App Runner status read"
  elif command -v aws >/dev/null 2>&1; then
    local prod_status
    prod_status=$(aws apprunner list-services --region "$AWS_REGION" \
      --query "ServiceSummaryList[?ServiceName=='hyperagent-app'].Status | [0]" --output text)
    [[ "$prod_status" == RUNNING ]] || fail "verify prod App Runner status is '$prod_status' (read-only check) — investigate"
    pass verify-prod-runner
  else
    note "verify aws cli absent; skipped prod App Runner status read"
  fi
  note "verify manual steps remain: magic-link sign-in on $SITE_URL/boards and prod-isolation row check (docs/SUPABASE_DEV_SPLIT.md step 10)"
  pass verify
}

# ---------------------------------------------------------------- dispatch
stage_arg=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      stage_arg=${2:-}
      [[ -n "$stage_arg" ]] || fail "usage --stage needs a name (${ALL_STAGES[*]})"
      shift 2
      ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      fail "usage unknown argument '$1' (try --help)"
      ;;
  esac
done

run_stage() {
  case "$1" in
    gate)      stage_gate ;;
    project)   stage_project ;;
    auth)      stage_auth ;;
    secrets)   stage_secrets ;;
    migrate)   stage_migrate ;;
    ci-vars)   stage_ci_vars ;;
    apprunner) stage_apprunner ;;
    verify)    stage_verify ;;
    *)         fail "usage unknown stage '$1' (${ALL_STAGES[*]})" ;;
  esac
}

if [[ -n "$stage_arg" ]]; then
  # Every stage needs the token; gate implicitly for single-stage runs.
  [[ "$stage_arg" == gate ]] || ensure_token
  run_stage "$stage_arg"
else
  for s in "${ALL_STAGES[@]}"; do
    run_stage "$s"
  done
fi
