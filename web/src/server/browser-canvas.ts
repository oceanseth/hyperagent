import type { CanvasBrowser } from '#/lib/canvas'
import { getBrowser, insertJob, listBrowsers, patchBrowser, recordJobEvent, removeBrowser, saveBrowser } from './canvas-db'
import { dispatchJob } from './dispatch'
import { createKernelBrowser, deleteKernelBrowser, kernelBrowserAvailable, KernelBrowserError, navigateKernelBrowser } from './kernel-browser'

// Live KERNEL browsers on the shared canvas. The row is written before launch
// so every participant sees a loading card; closing the card ends the session.

const MAX_BROWSERS = 4

export class CanvasBrowserError extends Error {}

/** Accepts "example.com" as well as full URLs; only public http(s) pages. */
export function normalizeBrowserUrl(value?: string): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  let url: URL
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`) }
  catch { throw new CanvasBrowserError('That does not look like a web address.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) {
    throw new CanvasBrowserError('Only public http(s) web addresses can be opened.')
  }
  return url.href
}

const failure = (error: unknown) =>
  error instanceof KernelBrowserError || error instanceof CanvasBrowserError ? error.message : 'The browser could not be started.'

export async function openCanvasBrowser(workspaceId: string, input: { url?: string; title?: string }, events?: { onChange?: (id: string) => void }) {
  const url = normalizeBrowserUrl(input.url)
  if (!(await kernelBrowserAvailable(workspaceId))) {
    throw new CanvasBrowserError('Cloud browsers are not connected. Connect KERNEL in Executor or add a KERNEL key in Settings.')
  }
  const open = await listBrowsers(workspaceId)
  if (open.length >= MAX_BROWSERS) {
    throw new CanvasBrowserError(`There are already ${open.length} browsers on the canvas. Close one first.`)
  }
  const browser: CanvasBrowser = {
    id: crypto.randomUUID(),
    title: (input.title?.trim() || (url ? new URL(url).hostname.replace(/^www\./, '') : 'Browser')).slice(0, 200),
    ...(url ? { url } : {}),
    status: 'starting',
    statusText: 'Starting a cloud browser…',
    createdAt: new Date().toISOString(),
  }
  await saveBrowser(workspaceId, browser)
  events?.onChange?.(browser.id)
  try {
    // Not tied to the chat request: a finished reply must not orphan a session.
    const session = await createKernelBrowser(workspaceId, url)
    const ready = await patchBrowser(workspaceId, browser.id, {
      status: 'ready', statusText: undefined, liveViewUrl: session.liveViewUrl,
      sessionId: session.sessionId, provider: session.provider,
    })
    if (!ready) {
      // Closed while starting: end the session we just created.
      await deleteKernelBrowser(workspaceId, session).catch(() => undefined)
      throw new CanvasBrowserError('The browser was closed before it finished starting.')
    }
    events?.onChange?.(browser.id)
    return ready
  } catch (error) {
    await patchBrowser(workspaceId, browser.id, { status: 'failed', statusText: failure(error) }).catch(() => undefined)
    events?.onChange?.(browser.id)
    throw error instanceof CanvasBrowserError || error instanceof KernelBrowserError ? error : new CanvasBrowserError(failure(error))
  }
}

export async function navigateCanvasBrowser(workspaceId: string, id: string, rawUrl: string) {
  const url = normalizeBrowserUrl(rawUrl)
  if (!url) throw new CanvasBrowserError('Say which page to open.')
  const browser = await getBrowser(workspaceId, id)
  if (!browser) throw new CanvasBrowserError('That browser is no longer on the canvas.')
  if (browser.status !== 'ready' || !browser.sessionId) throw new CanvasBrowserError('That browser is not ready yet.')
  const title = await navigateKernelBrowser(workspaceId, { sessionId: browser.sessionId, provider: browser.provider }, url)
  return await patchBrowser(workspaceId, id, { url, ...(title ? { title: title.slice(0, 200) } : {}) })
}

/** Removes the card first so it disappears for everyone, then ends the session. */
export async function closeCanvasBrowser(workspaceId: string, id: string) {
  const removed = await removeBrowser(workspaceId, id)
  if (removed?.sessionId) {
    await deleteKernelBrowser(workspaceId, { sessionId: removed.sessionId, provider: removed.provider }).catch(() => undefined)
  }
  return removed
}

export async function closeAllCanvasBrowsers(workspaceId: string) {
  const browsers = await listBrowsers(workspaceId)
  await Promise.allSettled(browsers.map((browser) => closeCanvasBrowser(workspaceId, browser.id)))
  return browsers
}

/**
 * Hands a task to the browser agent on the Fly worker, attached to this card's
 * KERNEL session. Returns immediately; progress shows on the card and in the
 * activity monitor, and the result lands on the canvas.
 */
export async function dispatchBrowserAgent(workspaceId: string, id: string, rawTask: string) {
  const task = rawTask.trim().slice(0, 4000)
  if (!task) throw new CanvasBrowserError('Say what the browser agent should do.')
  const browser = await getBrowser(workspaceId, id)
  if (!browser) throw new CanvasBrowserError('That browser is no longer on the canvas.')
  if (browser.status !== 'ready' || !browser.sessionId) throw new CanvasBrowserError('That browser is not ready yet.')
  const busy = browser.agent && ['queued', 'running'].includes(browser.agent.status)
    && Date.now() - Date.parse(browser.agent.updatedAt) < 3 * 60_000
  if (busy) throw new CanvasBrowserError(`The browser agent is still working on “${browser.agent!.task.slice(0, 80)}”. Wait for it to finish.`)
  const title = task.replace(/\s+/g, ' ').slice(0, 80)
  const { job } = await insertJob(workspaceId, title, task, [], [], { kind: 'browser', browserId: id })
  await patchBrowser(workspaceId, id, {
    agent: { jobId: job.id, task: task.slice(0, 500), status: 'queued', step: 'Waking the Fly browser agent…', updatedAt: new Date().toISOString() },
  })
  try {
    await dispatchJob(workspaceId, job.id)
  } catch {
    // The Fly worker also scans the queue, but if it is unreachable run the
    // same agent here so the task is not stranded.
    if (process.env.BROWSER_AGENT_INLINE_FALLBACK !== '0') {
      await recordJobEvent(workspaceId, job.id, { type: 'dispatch.fallback', message: 'Fly worker unreachable; the app server is running the browser agent.' }).catch(() => undefined)
      const { runBrowserAgentJob } = await import('./browser-agent')
      void runBrowserAgentJob(workspaceId, job.id).catch(() => undefined)
    }
  }
  return job
}
