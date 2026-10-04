# Phab

The Cloudflare app runs Assistant UI and the conversational Grok/Mastra agent.
Research runs separately on a Fly.io worker. Both use the `phab` Neon project.

## Background research and context stacks

The assistant's `queue_research` tool stores a job in Neon and acknowledges it.
The worker atomically claims queued jobs, discovers Executor MCP tools, searches
connected sources, and publishes a source stack with a cited Markdown summary.
Cosmos has a direct search adapter. Public document/PDF URLs and image URLs are
displayed as source cards; the summary uses Assistant UI's Markdown renderer.
The source service must allow embedding for an inline PDF preview; the original
PDF always has an open link. PDF bytes are not copied into Neon.

The canvas observes jobs and results through `/api/canvas`. Closing the page or
turning off the development computer does not stop the worker. Neon holds the
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
Fly also receives structured JSON logs keyed by job and worker ID, while
Cloudflare invocation logging is enabled for the app. Nothing in monitoring
depends on a local log tail remaining open.

Server secrets for the app: `XAI_API_KEY`, `DATABASE_URL`, `JOBS_URL`, and
`JOBS_SECRET`. The worker needs `XAI_API_KEY`, `DATABASE_URL`, `JOBS_SECRET`,
`EXECUTOR_MCP_URL`, `EXECUTOR_API_KEY`, and optionally `COSMOS_TOKEN`.
Keep values in ignored `.env.local` during development and the hosting secret
stores in production. Never send integration keys to the browser.

Deploy the research worker from `web/` with `fly deploy --remote-only --ha=false`.
Its `fly.toml` keeps one machine running to process the queue. GitHub Actions
uses an app-scoped `FLY_API_TOKEN` for subsequent worker deployments. The frontend
retains its Cloudflare deployment at https://phab.oxwilde.workers.dev/.

This repository deliberately runs no tests or typechecking gates in hackathon
mode. Production builds are part of deployment.

## Cloudflare deployments

GitHub Actions deploys `main` to the `phab` Worker and `dev` to `phab-dev`.
Each branch has its own workflow in `.github/workflows`, triggered by changes
to `web/` or its workflow, and can also be deployed with `workflow_dispatch`.

Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and
`XAI_API_KEY`. The xAI key is installed as a Worker secret during deployment;
keep all secret values out of committed files.

From `web/`, run `npm ci` and `npm run build:cloudflare`.
Nitro generates `.output/server/wrangler.json` with the server and static assets.
Preview it with `npx wrangler dev --config .output/server/wrangler.json`.
For a manual deployment, run `npm run deploy -- --name phab-dev` (development)
or `npm run deploy -- --name phab` (production), with Cloudflare credentials set.

The Workers build enables Node compatibility and browser export fallback for
Web Crypto dependencies. Server dependencies are bundled into the Worker.

# Getting Started

To run this application:

```bash
npm install
npm run dev
```

# Building For Production

To build this application for production:

```bash
npm run build
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
npm run build
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
