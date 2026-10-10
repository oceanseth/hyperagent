# Phab

The app runs Assistant UI and the conversational Mastra agent, with all model
inference served by the Neon AI Gateway. It deploys as a Node server container
on AWS App Runner behind the hyperagent.lol CloudFront distribution.
Research runs separately on a Fly.io worker. Board state lives in Supabase
Postgres through Prisma.
Web search and connected services (Exa, Neon API/MCP, AgentMail) come through
the Executor MCP; voice calls use browser speech APIs plus `/api/voice` turns.

## Background research and context stacks

The assistant's `queue_research` tool stores a job in Supabase and acknowledges it.
The worker atomically claims queued jobs, discovers Executor MCP tools, searches
connected sources, and publishes a source stack with a cited Markdown summary.
Cosmos has a direct search adapter. Public document/PDF URLs and image URLs are
displayed as source cards; the summary uses Assistant UI's Markdown renderer.
The source service must allow embedding for an inline PDF preview; the original
PDF always has an open link. PDF bytes are not copied into Supabase.

The canvas observes jobs and results through `/api/canvas`. Closing the page or
turning off the development computer does not stop the worker. Supabase holds the
queue, context stacks, and job state; a worker restart recovers queued work and
expired leases. Each browser gets an opaque HttpOnly workspace cookie. There is
no cross-device account sync yet. Card positions are browser preferences; source
content and summaries are stored remotely. Toggle **In context** on a summary to
choose which stacks subsequent prompts use (up to 20).

Sources appear progressively while tools are still working. Native web-search
citation events and Cosmos results create preliminary cards; the worker can add
draft summaries with `update_canvas`, then finalize with `publish_canvas`.
Cards retain their IDs and show working, complete, or partial-result status.

Open **Activity** on the canvas or `/monitor` for job history, worker location,
15-second heartbeats, step/tool timings, failures, and saved event traces.
**Copy debug report** exports a bounded, credential-redacted report suitable for
pasting into a debugging conversation. Older jobs predate detailed tracing.
Fly also receives structured JSON logs keyed by job and worker ID. Nothing in
monitoring depends on a local log tail remaining open.

Server secrets for the app: `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`,
`EXECUTOR_MCP_URL`, `EXECUTOR_API_KEY`, `SUPABASE_DATABASE_URL`,
`SUPABASE_DIRECT_URL`, `JOBS_URL`,
`JOBS_SECRET`, and for live company formation optional `NORTHWEST_ACCESS_TOKEN`
(plus `NORTHWEST_MCP_URL`, `MERCURY_API_TOKEN` when those providers are used).
Northwest is the default filing provider, not required. The worker needs
`NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`, `SUPABASE_DATABASE_URL`,
`JOBS_SECRET`, `EXECUTOR_MCP_URL`, `EXECUTOR_API_KEY`, and optionally
`COSMOS_TOKEN`. Google login needs `SESSION_SECRET` (any long random string;
it signs the session cookie). Sign-in itself runs through Firebase Auth's
Google provider — the public web config is baked in and can be swapped with
`FIREBASE_API_KEY` / `FIREBASE_AUTH_DOMAIN`; the serving domain must be in
that Firebase project's authorized domains list. Optional model overrides: `NEON_MODEL_ASSISTANT` (default
claude-sonnet-5), `NEON_MODEL_RESEARCH` (default gpt-5-5), and
`NEON_MODEL_BROWSER` (browser agent; defaults to the assistant model).
Values are mirrored in AWS SSM under `/hyperagent/*`.
Keep values in ignored `.env.local` during development and the hosting secret
stores in production. Never send integration keys to the browser.

Deploy the research worker from `web/` with `fly deploy --remote-only --ha=false`.
Its `fly.toml` keeps one machine running to process the queue.

## Database

Board, plan, and settings rows are in Supabase Postgres. The app reads them
through Prisma (`web/src/server/db.ts`) using `SUPABASE_DATABASE_URL`: the
transaction pooler on port 6543 with `?pgbouncer=true`, so Prisma does not
prepare statements. Migrations use `SUPABASE_DIRECT_URL`, the session pooler
on port 5432. Both values live in ignored `web/.env.local` and are never
committed. `DATABASE_URL` may still point at Neon for older trees; this app
does not read it.

Dev (dev.hyperagent.lol) uses its own Supabase project `hyperagent-dev`; its
connection URLs and keys live in OpenBao under `kv/shared/supabase-dev`
(see `docs/SUPABASE_DEV_SPLIT.md` for the split runbook and env vars).

Add a migration by writing SQL into a new folder under
`web/prisma/migrations/<timestamp>_<name>/migration.sql`. Generate table SQL
with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
(or a diff from the previous datamodel) and apply with `prisma migrate deploy`.
Never use `prisma migrate dev` or `prisma db push` against the shared dev
project: there is no shadow database, and those commands can reset data.

The server connects as the table owner, so row level security does not apply
to Prisma and server writes keep working. RLS is enabled and not forced.
The Data API and Realtime see member rows only: authenticated select policies
call `private.is_board_member`, and tables without a policy stay server-only.
Anonymous cookie boards have no members, so those clients see nothing.

`scripts/supabase-selftest.sh` checks the port. Subcommands: `schema`,
`migrate`, `rls`, `isolation`, `http`, and `built`. Each one removes only the
rows or temporary schema it created.

This repository deliberately runs no tests or typechecking gates in hackathon
mode. Production builds are part of deployment. Pull requests to `dev` still
run `.github/workflows/pr-check.yml` (install, typecheck, build, and images).

## Live browsers on the canvas

The assistant (chat and voice) can put KERNEL cloud browsers on the shared
canvas with `open_browser`, `navigate_browser`, `list_browsers`, and
`close_browser`. Each browser is a card holding the session's live view in an
iframe; everyone on a shared board sees and can drive it. Cards are stored in
Supabase (`phab_canvas_browsers`) and positions sync through the shared layout.
Closing a card (or `close_browser`) removes it and deletes the KERNEL session;
idle sessions end on their own about 10 minutes after the last viewer leaves.

KERNEL is reached through the Executor MCP first: the app `search`es Executor
for the connected KERNEL tools (`manage_browsers`, `execute_playwright_code`,
or per-operation browser tools) and calls them with `invoke`, so the KERNEL key
stays in Executor. If Executor has no KERNEL connection, the app falls back to
the KERNEL API with the workspace KERNEL key from Settings or `KERNEL_API_KEY`.
At most four browsers can be open per board.

### Browser agent (Fly worker)

Opening a browser only shows it; the browser agent is what acts in it. The
assistant's `browser_agent` tool (or the task field under any browser card)
queues a `kind = 'browser'` job in `phab_canvas_jobs` tied to that card and
wakes the Fly worker. The worker's agent uses Neon AI Gateway inference
(`NEON_MODEL_BROWSER`) and attaches to the card's KERNEL session through
[Playwright Execution](https://kernel.sh/docs/browsers/playwright-execution)
(KERNEL's recommended agent control path; the code runs in the browser's VM,
via Executor's `execute_playwright_code` or the KERNEL API). Its skills
(`web/src/server/browser-skills.ts`) are `read_page` (URL, text, and numbered
interactive elements across frames), `navigate`, `click` (by ref, text or
coordinates), `type_text`, `press_key`, `scroll`, `go_back`, `screenshot`, and
`finish`. Every action happens in the same session the card's live view shows,
so everyone watches it live; each step is logged to the Activity monitor and
shown on the card, and the final answer is published as a result card.

The worker needs KERNEL access for this: the same Executor secrets as the app
(`EXECUTOR_MCP_URL`, `EXECUTOR_API_KEY`) and/or `KERNEL_API_KEY`, matching
whichever path opened the browser. `BROWSER_AGENT_VISION=1` sends screenshots
to the model as images (only if the Neon model accepts images). If the app
cannot reach the worker (`JOBS_URL`), it runs the same agent in-process so the
task is not stranded; set `BROWSER_AGENT_INLINE_FALLBACK=0` to disable that.

## AWS deployments

GitHub Actions builds `web/Dockerfile.app` and pushes it to ECR
(`hyperagent-app`), and App Runner auto-deploys it — one pipeline per branch:

- `.github/workflows/deploy-dev.yml`: every push to `dev` → ECR tag `dev` →
  App Runner service `hyperagent-app-dev` → https://dev.hyperagent.lol/.
  **This is where all day-to-day work ships.**
- `.github/workflows/deploy-production.yml`: pushes to `production` → ECR tag
  `latest` → App Runner service `hyperagent-app`, served through CloudFront at
  https://hyperagent.lol/. **Never push to `production` unless specifically
  told to.**

Auth uses the OIDC role in the `AWS_DEPLOY_ROLE_ARN`
repository variable; there are no long-lived AWS keys in GitHub.

For a local production build: `NITRO_PRESET=node_server pnpm run build`, then
`node .output/server/index.mjs` with the env above.

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Vite through [portless](https://github.com/vercel-labs/portless)
(`portless run vite dev`). There is no fixed `--port 3001`. The dev script
still loads `web/.env.local` into the server with `dotenv-cli`, so values that
contain `&` are not split by the shell. The app name is `web` (from
`package.json`):

- Main checkout: `https://web.localhost`
- Linked worktree: `https://<branch>.web.localhost`, using the last segment of
  the branch name (`feature/my-fix` → `my-fix.web.localhost`)

The first run on a machine starts the HTTPS proxy on port 443, which asks for
sudo, and creates a local certificate authority. Trust it once with
`pnpm exec portless trust`.

Headless and no-sudo runs (agents, CI, containers) keep the proxy off port 443
and off the user `~/.portless` state directory:

```bash
export PORTLESS_STATE_DIR="${TMPDIR:-/tmp}/portless-hyperagent"
export PORTLESS_SYNC_HOSTS=0
pnpm exec portless proxy start --no-tls -p 1355
pnpm dev
# http://web.localhost:1355
# or http://<branch>.web.localhost:1355 in a linked worktree
pnpm exec portless proxy stop -p 1355
```

Linked worktrees are created and removed with the repo scripts. See
[Worktrees](../AGENTS.md#worktrees) in `AGENTS.md`.

# Building For Production

To build this application for production:

```bash
pnpm run build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`


## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
pnpm run build
node dist/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `dist/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).



# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
