# Supabase dev/prod split — findings and cutover runbook

Written 2026-10-09 on branch `fable/supabase-dev-split` (from `origin/dev` @ 70bb9ca).
Goal: give **dev.hyperagent.lol** (AWS App Runner service `hyperagent-app-dev`) its own
dedicated Supabase project (`hyperagent-dev`), so dev stops sharing the production
Supabase project `srtrucncutffceakivux`.

> **PROD MUST NOT BE TOUCHED.** Nothing in this runbook modifies:
> - Supabase project `srtrucncutffceakivux` (its settings, auth config, keys, or data),
> - App Runner service `hyperagent-app` (`arn:aws:apprunner:us-east-1:218827615080:service/hyperagent-app/ea0680cd25e640609aa9332384caa64e`),
> - the Fly research worker `hyperagent-research` or any `fly.toml`/`fly.app.toml`,
> - `.github/workflows/deploy-production.yml`,
> - the OpenBao secret `kv/shared/supabase` (prod values — read-only; new secrets go to `kv/shared/supabase-dev`).
> Every step below that calls `aws apprunner update-service` or the Supabase management
> API must be double-checked against the **dev** service ARN / the **new** project ref.

---

## 1. Findings

### 1.1 Supabase-related env vars the app actually reads

| Variable | Read by | Side | Notes |
|---|---|---|---|
| `SUPABASE_DATABASE_URL` | `web/prisma/schema.prisma` (`datasource.url`), `web/src/server/db.ts:20-21` (Prisma `datasourceUrl`, appends `connection_limit=20&pool_timeout=30`), `web/worker/index.ts:8` (hard requirement), `web/src/server/mcp.ts:72` (redaction list only) | server-only | Transaction pooler, port **6543**, must carry `?pgbouncer=true` |
| `SUPABASE_DIRECT_URL` | `web/prisma/schema.prisma` (`datasource.directUrl`), `web/scripts/supabase-migrate.mjs:4`, `web/scripts/supabase-rls.ts:7` | server-only | Session pooler, port **5432**; used for `prisma migrate deploy` and selftests |
| `SUPABASE_URL` | `web/src/server/supabase-server.ts:8` | server-only | **Falls back to hardcoded prod URL** `https://srtrucncutffceakivux.supabase.co` when unset. Not currently set on the dev App Runner service, so dev SSR auth talks to prod today. |
| `SUPABASE_KEY` | `web/src/server/supabase-server.ts:9` | server-only | Publishable (`sb_publishable_…`) key; **falls back to the hardcoded prod publishable key** when unset |
| `VITE_SUPABASE_URL` | `web/src/utils/supabase.ts:7`, typed in `web/src/env.d.ts` | **client-exposed, baked at build time** | Vite inlines it during `vite build`; value comes from the committed `web/.env.production` (prod project URL) |
| `VITE_SUPABASE_KEY` | `web/src/utils/supabase.ts:8`, typed in `web/src/env.d.ts` | **client-exposed, baked at build time** | Publishable key; same baking mechanism. The browser client also carries Realtime (`web/src/lib/canvas-realtime.ts`) and the magic-link sign-in (`web/src/routes/boards.tsx`) |
| `SUPABASE_SECRET_KEY` | nowhere (only `web/scripts/agent-activity-proof.mjs:102`, which **asserts it is absent**) | — | The app never uses a service-role/secret key at runtime. It is still needed out-of-band (demo-video stage: admin user creation) |
| `DATABASE_URL` | not read by the app (`web/README.md` §Database: "may still point at Neon for older trees; this app does not read it"); appears in `web/src/server/mcp.ts:72` redaction list | — | Legacy Neon URL still present on the dev App Runner service; leave it alone |

Key structural facts:

- **Prisma**: schema at `web/prisma/schema.prisma` (provider `postgresql`, `url = env("SUPABASE_DATABASE_URL")`, `directUrl = env("SUPABASE_DIRECT_URL")`). Migrations live in `web/prisma/migrations/` — currently six: `20261007140000_init`, `20261007140100_rls`, `20261008000000_realtime`, `20261008050000_agent_tokens`, `20261009020000_nullable_agent_colors`, `20261009150000_chat_authors`. RLS policies and Realtime triggers are **inside the migrations**, so `prisma migrate deploy` provisions the new project completely. Never `migrate dev` / `db push` (no shadow DB; see `web/README.md`).
- **Client bundle baking is the central cutover constraint.** `web/Dockerfile.app` runs `NITRO_PRESET=node_server pnpm run build` with no build args; Vite production mode loads the **committed** `web/.env.production`, which contains the prod `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`. The dev image (`hyperagent-app:dev`, built by `.github/workflows/deploy-dev.yml`) therefore ships a browser bundle pinned to prod. App Runner runtime env vars **cannot** fix the browser side; only the server side (`SUPABASE_URL`/`SUPABASE_KEY`, Prisma URLs) is runtime-configurable. See step 8.
- **Hardcoded prod fallbacks** in `web/src/server/supabase-server.ts:8-9`:
  ```ts
  const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || 'https://srtrucncutffceakivux.supabase.co'
  const SUPABASE_KEY = process.env.SUPABASE_KEY?.trim() || 'sb_publishable_CKkkRTJvWECPp8dYk3ijsg_nJjLaIYq'
  ```
  (Both values are public by design.) Setting the env vars on the dev service overrides them; no code change required.
- **Selftests**: `scripts/supabase-selftest.sh` (subcommands `schema|migrate|rls|isolation|http|built`) runs `web/scripts/supabase-*.{mjs,ts}` through `dotenv -e .env.local`. `migrate` applies the migrations into a throwaway schema and drops it — a safe smoke test against the new dev project.

### 1.2 App Runner (dev)

- **Service:** `hyperagent-app-dev`, **region `us-east-1`**, account 218827615080
- **ARN:** `arn:aws:apprunner:us-east-1:218827615080:service/hyperagent-app-dev/a45352f0a17e499389db9bdc8b644d5b`
- Image: `218827615080.dkr.ecr.us-east-1.amazonaws.com/hyperagent-app:dev`, auto-deploy **on**, port 3000, access role `hyperagent-apprunner-ecr`, no instance role, no `RuntimeEnvironmentSecrets` (everything is a plain runtime env var), 0.25 vCPU / 512 MB.
- Current runtime env var **names** (values omitted/masked): `DATABASE_URL`, `EXECUTOR_API_KEY`, `EXECUTOR_MCP_URL` (`https://executor.sh/phab02/mcp?mode=passthrough`), `FLY_MACHINES_TOKEN`, `JOBS_SECRET`, `JOBS_URL` (`https://hyperagent-research.fly.dev`), `MONID_API_KEY`, `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`, `PUBLIC_ORIGINS` (`https://dev.hyperagent.lol`), `SESSION_SECRET`, `SUPABASE_DATABASE_URL`, `SUPABASE_DIRECT_URL`.
- Note `SUPABASE_URL` / `SUPABASE_KEY` are **not set** today (prod fallback active), and `SUPABASE_DATABASE_URL`/`SUPABASE_DIRECT_URL` currently point at the prod project.
- The **prod** service `hyperagent-app` lives in the same region/account. Triple-check the ARN before any `update-service`.

### 1.3 Fly research worker — split consequence (decision point)

`JOBS_URL` on dev points at the **prod** Fly worker (`hyperagent-research.fly.dev`, region iad). That worker reads `SUPABASE_DATABASE_URL` from Fly secrets → the **prod** DB. After the split, research/browser jobs queued from dev are written to the **dev** DB, which the prod worker never scans — so **dev background research jobs will sit queued forever**. Browser-agent jobs still work via the in-process fallback (`BROWSER_AGENT_INLINE_FALLBACK`, on by default; `web/README.md`). Options, explicitly **out of scope** for this cutover (both touch Fly, which is prod territory):
1. Accept it: dev is a preview environment; research stays untested on dev (recommended for now — document it).
2. Later, stand up a second Fly app (e.g. `hyperagent-research-dev`) with dev secrets and point dev's `JOBS_URL` at it.

### 1.4 OpenBao state (as of 2026-10-09)

- Address `https://bao.dotsrt.com`, namespace `hyperagent`, KV v2 mount `kv`, AppRole auth from `~/.config/hyperagent/fable-bao-dolt.env` (login path `auth/approle/login`).
- `kv/shared/supabase` holds exactly two keys: `SUPABASE_DATABASE_URL`, `SUPABASE_DIRECT_URL` (prod). **`SUPABASE_ACCESS_TOKEN` is NOT present yet** — lou was asked to add it; the runbook is gated on it (step 0).
- **Write access confirmed**: token capabilities on `kv/data/shared/supabase*` are `create, delete, patch, read, update`; a throwaway write to `kv/data/shared/supabase-dev-writetest` returned 200 and was soft-deleted (204). `kv/metadata/...` delete is 403, so version history cannot be purged — **never write a secret to a wrong key name "temporarily"**.

### 1.5 Auth flow

- Sign-in is **email magic link only**: `web/src/routes/boards.tsx:46-49` calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: \`${location.origin}/boards\` } })`. The redirect target is **dynamic** (`location.origin`) — no hardcoded localhost anywhere in the app.
- The magic-link landing (`/boards?code=…`) completes the PKCE exchange via `supabase.auth.getSession()` (`boards.tsx:22-25`), which writes `sb-*` cookies; the server reads them through `web/src/server/supabase-server.ts` (`accountFromRequest` in `web/src/server/account.ts`).
- **Supabase-side settings that matter:** a brand-new project defaults Site URL to `http://localhost:3000` with an empty redirect allowlist, so magic links from dev would land on localhost. The new project needs Site URL `https://dev.hyperagent.lol` and redirect allowlist `https://dev.hyperagent.lol/**` (step 4). Email provider + magic links are enabled by default on new projects.
- **No GitHub (or any) OAuth provider is configured in code** — `signInWithOAuth` does not appear in `web/src`. GitHub on the dev project is optional and needs its own GitHub OAuth app; skip unless creds are provided (step 4b).
- Realtime (`web/src/lib/canvas-realtime.ts`) and the browser auth client both use the **baked** `VITE_` values — another reason step 8 matters.

### 1.6 Connection string shapes (prod reference — for format only)

From the reference checkout's env file (values redacted; do not copy secrets):

```
SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
SUPABASE_DIRECT_URL=  postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Prod is `aws-0-ap-south-1`. The new dev project should be **us-east-1** (same region as App Runner), so expect `aws-0-us-east-1.pooler.supabase.com` — but the host index (`aws-0` vs `aws-1`) varies by Supavisor tenant; **take the exact host from the management API / dashboard rather than guessing** (step 5). Both URLs use the pooler host (the "direct" URL is the session pooler on 5432; new projects' `db.<ref>.supabase.co` is IPv6-only).

### 1.7 Stale "ship to production / pinned dev" doc passages

lou has restored the normal merge-to-dev flow (dev is day-to-day, production promotes from dev). These passages still describe the 2026-10-07 "no dev hop" freeze and/or the shared database and must be corrected:

1. **`AGENTS.md` lines 13–35**, section `## Hackathon mode: ship constantly — to production`, including:
   > "Since 2026-10-07 (lou's call) completed work ships directly to `production`; there is no dev hop."
   > "**Always ship to `production`.** Push completed web changes to the `production` branch without asking for confirmation…"
   > "`dev` deploys https://dev.hyperagent.lol/ and is for previews only. Keep it fast-forwardable to `production`."
   > "Ship to production, push, repeat."
2. **`README.md` lines 76–89**, section `## Branches and deployment`: the branch table row
   > "`production` | hyperagent.lol | Everyone — completed work ships straight here (rule change 2026-10-07)"
   and rules 2–3 ("**Ship to `production`.** Push completed work to the `production` branch… Keep `dev` fast-forwardable to `production`; use it only when something needs a preview…").
3. **`README.md` line 89** (becomes false after this cutover):
   > "Dev currently shares the production database and research worker, so schema-destructive experiments still need care."
   Replace with: dev has its own Supabase project (`hyperagent-dev`); the research worker is still shared/prod-only (per §1.3) until a dev worker exists.

(`web/README.md` lines 140–147 already describe `dev` as "where all day-to-day work ships" and warn against pushing `production` — consistent with the restored flow; no change needed there.)

---

## 2. Cutover runbook

Idempotent: every step starts with a check and skips itself if already done. All
Supabase management API calls are gated on `SUPABASE_ACCESS_TOKEN` (step 0).
Management API base: `https://api.supabase.com`, auth header
`Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. The OpenAPI spec is at
`https://api.supabase.com/api/v1-json` — **verify any field name below against it
before scripting** (noted where schema details are from memory, not probed —
no management token existed at investigation time).

**Shell note (Windows):** run from Git Bash or PowerShell; never let MSYS path
conversion near connection strings or API paths (`MSYS_NO_PATHCONV=1` if needed).
Quote every URL (they contain `&`). Never echo secret values; pipe JSON through
`jq`/python filters that print key names and non-secret fields only.

### Step 0 — Gate: fetch the management token from OpenBao

1. Source `~/.config/hyperagent/fable-bao-dolt.env`, AppRole-login:
   `POST $BAO_ADDR/v1/auth/approle/login` with `role_id`/`secret_id`, header `X-Vault-Namespace: hyperagent`; take `.auth.client_token`.
2. `GET $BAO_ADDR/v1/kv/data/shared/supabase` (headers `X-Vault-Token`, `X-Vault-Namespace: hyperagent`); look for key `SUPABASE_ACCESS_TOKEN` in `.data.data`.
3. **If absent: STOP.** Report "waiting on lou to drop SUPABASE_ACCESS_TOKEN into kv/shared/supabase". Do not improvise another token source.
4. If present, export it into the script's environment only (never a file, never logs). Sanity check: `GET https://api.supabase.com/v1/organizations` returns 200.

### Step 1 — Identify the organization

```
curl -s https://api.supabase.com/v1/organizations -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```
Returns `[{ "id": "<org-slug>", "name": … }]`. Record the org `id` (slug). If more
than one org, pick the one that owns project `srtrucncutffceakivux`
(`GET /v1/projects` lists projects with their `organization_id`).

### Step 2 — Idempotency check: does `hyperagent-dev` already exist?

`GET https://api.supabase.com/v1/projects` — if a project named `hyperagent-dev`
exists, record its `id` (= project **ref**, the `xxxxxxxxxxxxxxxxxxxx` string) and
**skip step 3**. Otherwise continue.

### Step 3 — Create the dev project

1. Generate a DB password: **alphanumeric only** (it gets embedded in connection
   strings; avoid `@:/?&%#` entirely), e.g. `openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32`.
2. **Immediately** store it in OpenBao (step 6 key `SUPABASE_DB_PASSWORD`) before using it — don't hold it only in a shell variable.
3. Create:
   ```
   curl -s -X POST https://api.supabase.com/v1/projects \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"hyperagent-dev","organization_id":"<org-slug>","region":"us-east-1","db_pass":"<generated>"}'
   ```
   (Field names `organization_id`/`db_pass`/`region` — confirm against the OpenAPI spec. `us-east-1` co-locates with App Runner; prod is untouched in ap-south-1.)
4. Record the returned project `id` (ref).
5. Poll `GET /v1/projects/<ref>` until `status` is `ACTIVE_HEALTHY` (typically 1–3 min).
6. **Safety assert used by every later step:** `<ref> != srtrucncutffceakivux`. Abort if equal.

### Step 4 — Auth configuration (dev project only)

Patch the new project's auth config:
```
curl -s -X PATCH https://api.supabase.com/v1/projects/<ref>/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"site_url":"https://dev.hyperagent.lol","uri_allow_list":"https://dev.hyperagent.lol/**"}'
```
- `site_url` = `https://dev.hyperagent.lol`; `uri_allow_list` is a comma-separated string — include at least `https://dev.hyperagent.lol/**`. Optionally add `http://localhost:*/**`-style local dev entries later; do not add prod URLs.
- Email magic link: enabled by default on new projects (`external_email_enabled: true`); verify with `GET /v1/projects/<ref>/config/auth` and set it if the GET shows otherwise.
- **4b. GitHub provider — SKIP AND NOTE.** No OAuth provider exists in code (§1.5); enabling GitHub requires a dedicated GitHub OAuth app (client id/secret) which we do not have. If creds appear later: `PATCH …/config/auth` with `external_github_enabled: true`, `external_github_client_id`, `external_github_secret`, and set the GitHub app's callback to `https://<ref>.supabase.co/auth/v1/callback`.
- Idempotent: PATCH is a no-op when values already match (safe to re-run).

### Step 5 — Capture keys and connection URLs (names below; values go only to OpenBao)

| What | How |
|---|---|
| Project URL | `https://<ref>.supabase.co` |
| Publishable (anon) + secret (service_role) API keys | `GET /v1/projects/<ref>/api-keys?reveal=true` — returns both the new-style `sb_publishable_…` / `sb_secret_…` keys and (if issued) legacy `anon` / `service_role` JWTs. The app wants the **publishable** key. The demo-video stage wants the **service_role/secret** key — capture whichever of `service_role` (legacy JWT) / `sb_secret_` the project has; both work with supabase-js admin APIs. |
| Pooler URLs | `GET /v1/projects/<ref>/config/database/pooler` (Supavisor config: host, ports, user) — or read them off the dashboard Connect panel once. Construct per §1.6: transaction pooler `:6543` + `?pgbouncer=true` → `SUPABASE_DATABASE_URL`; session pooler `:5432` → `SUPABASE_DIRECT_URL`; user `postgres.<ref>`, db `postgres`, password from step 3. |

Verify the DB URLs actually connect before proceeding (e.g. `pnpm exec prisma db execute`-style ping or the migrate in step 7 doubles as the check).

### Step 6 — Store dev secrets in OpenBao `kv/shared/supabase-dev`

Write one KV v2 secret at `kv/data/shared/supabase-dev` (POST with `{"data":{…}}`;
re-running overwrites with a new version — fine). **Exact key names:**

- `SUPABASE_PROJECT_REF` — the new project ref (not secret, convenient)
- `SUPABASE_URL` — `https://<ref>.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_…` (public by design, stored for completeness)
- `SUPABASE_SERVICE_ROLE_KEY` — service_role / `sb_secret_…` key (**required by the later demo-video stage** for admin user creation)
- `SUPABASE_DB_PASSWORD` — raw DB password from step 3
- `SUPABASE_DATABASE_URL` — pooler `:6543` URL with `?pgbouncer=true`
- `SUPABASE_DIRECT_URL` — session pooler `:5432` URL

Do **not** write anything to `kv/shared/supabase` (prod). Write access to the
`supabase-dev` path was verified 2026-10-09.

### Step 7 — Apply Prisma migrations to the NEW project

From the repo worktree:
```bash
cd web
pnpm install --frozen-lockfile        # if node_modules absent
SUPABASE_DATABASE_URL='<dev :6543 url with pgbouncer=true>' \
SUPABASE_DIRECT_URL='<dev :5432 url>' \
pnpm exec prisma migrate deploy
```
- Both env vars are required (the schema references both; `migrate deploy` uses `directUrl`).
- **Never** run this with prod URLs in the environment — run in a clean shell, not one that sourced prod env files. `migrate deploy` is additive/idempotent (applies only pending migrations), and all six migrations (incl. RLS + Realtime) apply in order.
- Optional smoke test (throwaway schema, self-cleaning): put the dev URLs in an ignored `web/.env.local` in the **worktree** and run `scripts/supabase-selftest.sh migrate`.
- Expected tables afterwards: the 13 `phab_*` tables listed in `web/scripts/supabase-migrate.mjs:48-53`.

### Step 8 — Dev client bundle: bake dev `VITE_` values (one small CI edit)

The browser bundle is baked from the committed `web/.env.production` (§1.1), so
runtime env alone cannot repoint the dev client. Minimal-churn fix, **dev pipeline
only** (`.github/workflows/deploy-dev.yml`; `deploy-production.yml` untouched):

Add one step **before** "Build image" that overwrites `web/.env.production` in the
CI checkout (never committed):
```yaml
- name: Point client bundle at dev Supabase
  run: |
    printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_KEY=%s\n' \
      "${{ vars.DEV_SUPABASE_URL }}" "${{ vars.DEV_SUPABASE_KEY }}" > web/.env.production
```
with two new GitHub **repository variables** (not secrets — both values are public
by design): `DEV_SUPABASE_URL = https://<ref>.supabase.co`,
`DEV_SUPABASE_KEY = sb_publishable_…` (`gh variable set DEV_SUPABASE_URL --repo oceanseth/hyperagent --body …`).
Guard the step so a missing variable fails loudly rather than baking empty strings.
(Alternative considered and rejected for churn: `ARG`/`ENV` plumbing in
`web/Dockerfile.app`, which is shared with the prod build.)

The committed `web/.env.production` / `web/.env.development` keep the prod values —
local `pnpm dev` behavior and the prod image are unchanged. (If the team later
wants local dev against the dev project, that's an ignored `web/.env.local`
override — out of scope here; another stream is touching auth-adjacent web code.)

### Step 9 — App Runner env cutover (read-modify-write; DEV SERVICE ONLY)

`update-service` **replaces** the whole `SourceConfiguration`, so you must read the
current one, edit only the env map, and send everything back. Exact procedure:

```bash
ARN='arn:aws:apprunner:us-east-1:218827615080:service/hyperagent-app-dev/a45352f0a17e499389db9bdc8b644d5b'
# 0. SAFETY: refuse to run if $ARN contains '/hyperagent-app/' (the prod service).
aws apprunner describe-service --region us-east-1 --service-arn "$ARN" \
  --query 'Service.SourceConfiguration' --output json > sc.json
# 1. Edit sc.json (jq/python): in .ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables
#    - SET  SUPABASE_DATABASE_URL = <dev :6543 url>     (was prod)
#    - SET  SUPABASE_DIRECT_URL   = <dev :5432 url>     (was prod)
#    - ADD  SUPABASE_URL          = https://<ref>.supabase.co   (overrides hardcoded prod fallback)
#    - ADD  SUPABASE_KEY          = <dev sb_publishable_ key>
#    - change NOTHING else (DATABASE_URL, JOBS_*, NEON_*, EXECUTOR_*, SESSION_SECRET,
#      PUBLIC_ORIGINS, MONID_API_KEY, FLY_MACHINES_TOKEN all stay byte-identical;
#      AuthenticationConfiguration/ImageIdentifier/AutoDeploymentsEnabled stay as read)
aws apprunner update-service --region us-east-1 --service-arn "$ARN" \
  --source-configuration file://sc.json
rm sc.json   # it contains secrets — do not leave it on disk or in the repo
```
- Pull the dev values from OpenBao `kv/shared/supabase-dev` inside the script; never paste them into a committed file. `sc.json` must be written to a temp dir outside the repo.
- `update-service` triggers a deployment; poll `describe-service … --query Service.Status` until `RUNNING` (one operation at a time — concurrent ops fail with `OPERATION_IN_PROGRESS`, and the deploy-dev workflow may also be rolling; wait it out).
- Idempotency: before editing, diff the current env values against the desired ones; if already equal, skip the update.
- **Prod safety:** this command must never be pointed at the `hyperagent-app` ARN. The script must hard-code the dev ARN and assert the service name is `hyperagent-app-dev` from the describe output.

Ordering note: do step 8's variables + a `dev`-branch push (or re-run deploy-dev)
**and** step 9 in the same window; until both land, the dev browser bundle and the
dev server can briefly point at different projects (sessions/boards will look
empty or logins will bounce — harmless on a preview env, but verify after both).

### Step 10 — Verification (all read-only against prod)

1. `https://dev.hyperagent.lol/` loads (App Runner `RUNNING`, page renders).
2. View-source / network tab on dev: the browser bundle references `https://<ref>.supabase.co`, **not** `srtrucncutffceakivux`.
3. Fresh-user magic link: enter a test email on `https://dev.hyperagent.lol/boards`; the email's link must land back on `https://dev.hyperagent.lol/boards` (not localhost, not hyperagent.lol) and complete sign-in.
4. Isolation: create a board / note on dev, then confirm **no new row** appears in the old project — e.g. read-only `select count(*)` on prod `phab_board_members` / `phab_canvas_notes` before and after (prod creds from `kv/shared/supabase`, SELECT only), or check the new rows exist in the dev project instead.
5. Prod healthy: `https://hyperagent.lol/` loads, sign-in still works, prod App Runner `Service.Status == RUNNING`, and `describe-service` on the **prod** ARN shows its `SourceConfiguration` unchanged (same `UpdatedAt` as before the cutover).
6. Known-good gap (expected): research jobs queued on dev stay `queued` (§1.3) — not a regression.

---

## 3. Spec for the implementer

### 3.1 Script

- **Location:** `scripts/supabase-dev-split.sh` (repo convention: operational bash lives in `scripts/`, cf. `supabase-selftest.sh`; node helpers it needs can go in `web/scripts/` but none should be necessary — curl + jq + aws + pnpm cover it). Mark executable; `set -euo pipefail`; print check names and statuses only, never values (follow `supabase-selftest.sh`'s output style).
- **Inputs** (no CLI secrets):
  - OpenBao bootstrap from `~/.config/hyperagent/fable-bao-dolt.env` (AppRole login; see step 0),
  - reads `kv/shared/supabase` (gate: `SUPABASE_ACCESS_TOKEN`) and reads/writes `kv/shared/supabase-dev`,
  - constants in the script: dev App Runner ARN, region `us-east-1`, project name `hyperagent-dev`, prod ref `srtrucncutffceakivux` (for the inequality assert), Supabase region `us-east-1`.
- **Stages, each with an idempotency check (re-run = converge, no duplicates):**
  1. `gate` — token present in OpenBao, `GET /v1/organizations` 200; else exit with a clear "waiting on SUPABASE_ACCESS_TOKEN" message.
  2. `project` — reuse existing `hyperagent-dev` or create (steps 1–3); wait `ACTIVE_HEALTHY`; assert ref ≠ prod ref.
  3. `auth` — GET config, PATCH only the drifted fields (step 4); GitHub skipped with a printed note.
  4. `secrets` — ensure all seven keys of step 6 exist at `kv/shared/supabase-dev`; fill missing ones (keys/URLs from step 5). Never touch `kv/shared/supabase`.
  5. `migrate` — `prisma migrate deploy` with dev URLs (step 7); `migrate deploy` itself is idempotent.
  6. `ci-vars` — ensure GitHub repo variables `DEV_SUPABASE_URL`/`DEV_SUPABASE_KEY` (step 8) via `gh variable set` (idempotent by nature).
  7. `apprunner` — read-modify-write only if drifted (step 9), then wait `RUNNING`.
  8. `verify` — automatable parts of step 10 (bundle grep via `curl -s https://dev.hyperagent.lol/ | grep -c <ref>`, prod health curl, prod-service `UpdatedAt` unchanged).
  - A `--stage <name>` flag to run one stage, default all in order.
- **Hard rules in the script:** every mutating call carries an assert that the target is dev (`hyperagent-app-dev` ARN check, `<ref> != srtrucncutffceakivux`); temp files with secrets go to `mktemp -d` outside the repo and are removed on EXIT trap; nothing is committed by the script.

### 3.2 One-time repo edits (small, dev-only)

1. `.github/workflows/deploy-dev.yml` — add the "Point client bundle at dev Supabase" step from step 8, before "Build image". Do **not** touch `deploy-production.yml` or `web/Dockerfile.app`.
2. **Stale-doc corrections** (§1.7):
   - `AGENTS.md` §"Hackathon mode": rewrite to the restored flow — day-to-day work merges to `dev` (deploys dev.hyperagent.lol); `production` is promoted from `dev` when ready; drop "no dev hop", "Always ship to production", "previews only / fast-forwardable" framing, keep the one-deploy-at-a-time and always-push guidance.
   - `README.md` §"Branches and deployment": flip the table/rules to match (dev = default target for completed work, production = promotion), and replace line 89's "Dev currently shares the production database and research worker" with: dev uses its own Supabase project `hyperagent-dev` (see `docs/SUPABASE_DEV_SPLIT.md`); the Fly research worker is still prod-only, so dev research jobs queue without running.
   - Optionally add one line to `web/README.md` §Database noting dev's separate project and that dev DB URLs live in OpenBao `kv/shared/supabase-dev`.
3. **No web/src code changes required or wanted** for this cutover (the hardcoded fallbacks in `supabase-server.ts` are overridden by env; another stream owns auth-adjacent web code — leave it alone).

### 3.3 Out of scope / do not touch

Supabase project `srtrucncutffceakivux` in any way; App Runner `hyperagent-app`;
Fly (`fly.toml`, `fly.app.toml`, `hyperagent-research`, Fly secrets);
`deploy-production.yml`; `kv/shared/supabase` contents; committed
`web/.env.production` values (prod build still uses them); the legacy
`DATABASE_URL` env var on the dev service (unused — leave as-is); a dev research
worker (§1.3, future work).
