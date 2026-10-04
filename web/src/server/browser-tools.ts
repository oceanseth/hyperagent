import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { listBrowsers } from './canvas-db'
import { closeAllCanvasBrowsers, closeCanvasBrowser, dispatchBrowserAgent, navigateCanvasBrowser, openCanvasBrowser } from './browser-canvas'

const message = (error: unknown) => error instanceof Error ? error.message : 'The browser request failed.'

export function browserTools(workspaceId: string, onRefresh?: () => void, onFocus?: (id: string) => void) {
  const onChange = (id: string) => { onRefresh?.(); onFocus?.(id) }
  return {
    open_browser: createTool({
      id: 'open_browser',
      description: 'Open a live KERNEL cloud browser as a card on the shared canvas, optionally at a URL. Everyone on the board sees and can use the live view. Use for "open a browser to X", showing a website, or any site without an API. Returns the browser id for navigate_browser and close_browser.',
      inputSchema: z.object({
        url: z.string().max(4096).optional().describe('Page to open, e.g. "https://example.com" or "example.com".'),
        title: z.string().max(200).optional().describe('Short card label; defaults to the site name.'),
      }),
      execute: async ({ url, title }) => {
        try {
          const browser = await openCanvasBrowser(workspaceId, { url, title }, { onChange })
          return { ok: true, browserId: browser.id, title: browser.title, url: browser.url, note: 'The live browser is on the canvas.' }
        } catch (error) { return { ok: false, error: message(error) } }
      },
    }),
    navigate_browser: createTool({
      id: 'navigate_browser',
      description: 'Send an open canvas browser to another URL. Use the browserId from open_browser or list_browsers.',
      inputSchema: z.object({ browserId: z.string().uuid(), url: z.string().min(1).max(4096) }),
      execute: async ({ browserId, url }) => {
        try {
          const browser = await navigateCanvasBrowser(workspaceId, browserId, url)
          onChange(browserId)
          return { ok: true, browserId, url: browser?.url, title: browser?.title }
        } catch (error) { return { ok: false, error: message(error) } }
      },
    }),
    browser_agent: createTool({
      id: 'browser_agent',
      description: 'Have the browser agent (runs on Fly, attaches to a canvas browser\'s live session) perform actions in it: click buttons, accept/reject cookies, fill and submit forms, search, scroll, read and extract page content. Pass the task in plain words with any needed values. Uses browserId, or the only open browser; opens a browser at url first if none is open. Returns at once; everyone watches the agent work in the live view and its result lands on the canvas.',
      inputSchema: z.object({
        task: z.string().min(1).max(4000).describe('What to do in the browser, e.g. "Accept the cookie banner, then open the Menu page and list the first five items."'),
        browserId: z.string().uuid().optional(),
        url: z.string().max(4096).optional().describe('Where to open a new browser when none is on the canvas.'),
      }),
      execute: async ({ task, browserId, url }) => {
        try {
          let id = browserId
          if (!id) {
            const ready = (await listBrowsers(workspaceId)).filter((browser) => browser.status === 'ready')
            if (ready.length > 1) return { ok: false, error: 'Several browsers are open. Pass the browserId from list_browsers.', browsers: ready.map(({ id: entry, title, url: page }) => ({ id: entry, title, url: page })) }
            id = ready[0]?.id ?? (await openCanvasBrowser(workspaceId, { url }, { onChange })).id
          }
          const job = await dispatchBrowserAgent(workspaceId, id, task)
          onChange(id)
          return { ok: true, browserId: id, jobId: job.id, note: 'The browser agent is working in the live view; its result will appear on the canvas. Do not claim it is done yet.' }
        } catch (error) { return { ok: false, error: message(error) } }
      },
    }),
    list_browsers: createTool({
      id: 'list_browsers',
      description: 'List live browsers currently on the canvas (id, title, url, status, and the browser agent\'s latest task/result).',
      inputSchema: z.object({}),
      execute: async () => ({
        browsers: (await listBrowsers(workspaceId)).map(({ id, title, url, status, statusText, agent }) => ({ id, title, url, status, statusText, agent })),
      }),
    }),
    close_browser: createTool({
      id: 'close_browser',
      description: 'Close a canvas browser and end its KERNEL session. Pass browserId, or all=true to close every browser on the canvas.',
      inputSchema: z.object({ browserId: z.string().uuid().optional(), all: z.boolean().optional() }),
      execute: async ({ browserId, all }) => {
        try {
          if (all) {
            const closed = await closeAllCanvasBrowsers(workspaceId)
            onRefresh?.()
            return { ok: true, closed: closed.length }
          }
          if (!browserId) return { ok: false, error: 'Pass a browserId or all=true.' }
          const closed = await closeCanvasBrowser(workspaceId, browserId)
          onRefresh?.()
          return closed ? { ok: true, closed: 1 } : { ok: false, error: 'That browser is no longer on the canvas.' }
        } catch (error) { return { ok: false, error: message(error) } }
      },
    }),
  }
}
