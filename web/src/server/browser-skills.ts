import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { executeKernelPlaywright, KernelBrowserError, type KernelRef } from './kernel-browser'

// Browser skills for agents attached to a live KERNEL session. Every skill is
// Playwright code run inside the browser's VM (KERNEL's recommended agent
// control path), so actions show up in the canvas live view as they happen and
// work whether the session was opened through Executor or the KERNEL API.
//
// read_page tags visible interactive elements with data-ha-ref attributes and
// returns them as refs like "0:12" (frame index : element number); click and
// type address elements by ref, falling back to visible text or coordinates.

export const REF_ATTRIBUTE = 'data-ha-ref'
const MAX_ELEMENTS = 120
const MAX_TEXT = 6000

// Shared prelude: act on the newest open tab (a click may open one) and pass
// arguments as JSON so no value is ever spliced into code unescaped.
const prelude = (args: unknown) => `const args = ${JSON.stringify(args ?? {})};
const tabs = context.pages().filter((p) => !p.isClosed());
const target = tabs[tabs.length - 1] ?? page;
await target.bringToFront().catch(() => {});
const settle = () => target.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
const state = async () => ({ url: target.url(), title: await target.title().catch(() => '') });
const byRef = (ref) => {
  const [frameIndex, number] = String(ref).split(':');
  const frame = target.frames()[Number(frameIndex)];
  if (!frame || !number) throw new Error('Unknown element ref ' + ref + '. Call read_page again.');
  return frame.locator('[${REF_ATTRIBUTE}="' + number + '"]').first();
};
`

/** Page state plus numbered interactive elements across the page and its frames. */
export const readPageCode = (options: { maxElements?: number; maxText?: number } = {}) => `${prelude({ maxElements: options.maxElements ?? MAX_ELEMENTS, maxText: options.maxText ?? MAX_TEXT })}
const collect = (input) => {
  const { limit, attribute, withText, maxText } = input;
  const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,label[for],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
  document.querySelectorAll('[' + attribute + ']').forEach((el) => el.removeAttribute(attribute));
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
      && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  const elements = [];
  let number = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= limit) break;
    if (!shown(el) || el.disabled) continue;
    number += 1;
    el.setAttribute(attribute, String(number));
    const box = el.getBoundingClientRect();
    const label = el.getAttribute('aria-label') || el.innerText || (el.type === 'password' ? '' : el.value) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '';
    elements.push({
      n: number, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined, name: String(label).replace(/\\s+/g, ' ').trim().slice(0, 80),
      x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2),
      ...(el.checked ? { checked: true } : {}),
    });
  }
  const text = withText ? (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, maxText) : '';
  return { elements, text, scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight };
};
const frames = target.frames().slice(0, 8);
const elements = [];
let main = { text: '', scrollY: 0, scrollHeight: 0, viewportHeight: 0 };
for (let index = 0; index < frames.length; index += 1) {
  const frame = frames[index];
  let offset = { x: 0, y: 0 };
  if (index > 0) {
    const owner = await frame.frameElement().catch(() => null);
    const box = owner ? await owner.boundingBox().catch(() => null) : null;
    if (!box) continue;
    offset = { x: box.x, y: box.y };
  }
  const found = await frame.evaluate(collect, { limit: args.maxElements - elements.length, attribute: '${REF_ATTRIBUTE}', withText: index === 0, maxText: args.maxText }).catch(() => null);
  if (!found) continue;
  if (index === 0) main = found;
  for (const item of found.elements) {
    const { n, ...rest } = item;
    elements.push({ ref: index + ':' + n, ...rest, x: Math.round(item.x + offset.x), y: Math.round(item.y + offset.y), ...(index > 0 ? { frame: frame.url().slice(0, 120) } : {}) });
  }
  if (elements.length >= args.maxElements) break;
}
return { ...(await state()), tabs: tabs.length, scrollY: main.scrollY, scrollHeight: main.scrollHeight, viewportHeight: main.viewportHeight, elements, text: main.text };`

export const navigateCode = (url: string) => `${prelude({ url })}
await target.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
return await state();`

export const clickCode = (input: { ref?: string; text?: string; x?: number; y?: number; double?: boolean }) => `${prelude(input)}
const before = tabs.length;
if (args.ref) {
  const element = byRef(args.ref);
  await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await element.click({ timeout: 8000, clickCount: args.double ? 2 : 1 }).catch(async (error) => {
    // Overlays sometimes intercept pointer events; fall back to the element's centre.
    const box = await element.boundingBox();
    if (!box) throw error;
    await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: args.double ? 2 : 1 });
  });
} else if (args.text) {
  const name = args.text;
  const element = target.getByRole('button', { name }).or(target.getByRole('link', { name })).or(target.getByText(name)).first();
  await element.click({ timeout: 8000, clickCount: args.double ? 2 : 1 });
} else if (typeof args.x === 'number' && typeof args.y === 'number') {
  await target.mouse.click(args.x, args.y, { clickCount: args.double ? 2 : 1 });
} else throw new Error('Pass ref, text, or x and y.');
await target.waitForTimeout(400);
await settle();
const now = context.pages().filter((p) => !p.isClosed());
return { ...(await state()), ...(now.length > before ? { openedTab: true } : {}) };`

export const typeCode = (input: { ref?: string; text: string; clear?: boolean; submit?: boolean }) => `${prelude(input)}
if (args.ref) {
  const element = byRef(args.ref);
  await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const editable = await element.evaluate((el) => ['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable).catch(() => false);
  if (editable && args.clear !== false) await element.fill(args.text, { timeout: 8000 });
  else { await element.click({ timeout: 8000 }); await target.keyboard.type(args.text, { delay: 25 }); }
} else {
  await target.keyboard.type(args.text, { delay: 25 });
}
if (args.submit) { await target.keyboard.press('Enter'); await target.waitForTimeout(500); await settle(); }
return await state();`

export const pressCode = (key: string) => `${prelude({ key })}
await target.keyboard.press(args.key);
await target.waitForTimeout(300);
await settle();
return await state();`

export const scrollCode = (input: { direction: 'up' | 'down'; amount?: number; ref?: string }) => `${prelude(input)}
if (args.ref) {
  await byRef(args.ref).scrollIntoViewIfNeeded({ timeout: 5000 });
} else {
  const size = target.viewportSize() ?? { width: 1280, height: 800 };
  await target.mouse.move(size.width / 2, size.height / 2);
  await target.mouse.wheel(0, (args.direction === 'up' ? -1 : 1) * (args.amount ?? Math.round(size.height * 0.8)));
}
await target.waitForTimeout(400);
return { ...(await state()), scrollY: await target.evaluate(() => Math.round(scrollY)), scrollHeight: await target.evaluate(() => document.documentElement.scrollHeight) };`

export const backCode = () => `${prelude({})}
await target.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
return await state();`

export const screenshotCode = () => `${prelude({})}
const image = await target.screenshot({ type: 'jpeg', quality: 55, timeout: 15000 });
return { ...(await state()), jpegBase64: Buffer.from(image).toString('base64') };`

export type BrowserAction = { skill: string; summary: string; ok: boolean; durationMs: number; url?: string; title?: string }
type PageState = { url?: string; title?: string }

const pageState = (value: unknown): PageState => {
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    ...(typeof object.url === 'string' ? { url: object.url.slice(0, 2000) } : {}),
    ...(typeof object.title === 'string' ? { title: object.title.slice(0, 200) } : {}),
  }
}

/** Runs one skill and reports it. Errors become results the model can react to. */
export async function runSkill(options: {
  workspaceId: string; browser: KernelRef; skill: string; summary: string; code: string
  timeoutSec?: number; signal?: AbortSignal; onAction?: (action: BrowserAction) => void | Promise<void>
}) {
  const started = Date.now()
  try {
    const outcome = await executeKernelPlaywright(options.workspaceId, options.browser, options.code, { timeoutSec: options.timeoutSec, signal: options.signal })
    const state = pageState(outcome.result)
    await options.onAction?.({ skill: options.skill, summary: options.summary, ok: !outcome.error, durationMs: Date.now() - started, ...state })
    return outcome.error ? { ok: false as const, error: outcome.error } : { ok: true as const, result: outcome.result }
  } catch (error) {
    if (options.signal?.aborted) throw error
    const message = error instanceof KernelBrowserError ? error.message : 'The browser action failed.'
    await options.onAction?.({ skill: options.skill, summary: options.summary, ok: false, durationMs: Date.now() - started })
    return { ok: false as const, error: message }
  }
}

const refSchema = z.string().regex(/^\d{1,2}:\d{1,4}$/).describe('Element ref from read_page, e.g. "0:12".')

/**
 * Mastra tools for an agent driving one KERNEL session. `vision` lets the
 * model see screenshots; without it, screenshots are only reported.
 */
export function browserSkillTools(options: {
  workspaceId: string; browser: KernelRef; signal?: AbortSignal; vision?: boolean
  onAction?: (action: BrowserAction) => void | Promise<void>
}) {
  const run = (skill: string, summary: string, code: string, timeoutSec?: number) =>
    runSkill({ ...options, skill, summary, code, timeoutSec })
  return {
    read_page: createTool({
      id: 'read_page',
      description: 'Read the current tab: URL, title, visible text, and numbered interactive elements (ref, tag, role, name, centre x/y). Call this first and again after anything changes the page; refs are only valid until the next read_page.',
      inputSchema: z.object({}),
      execute: async () => run('read_page', 'Read the page', readPageCode(), 20),
    }),
    navigate: createTool({
      id: 'navigate',
      description: 'Open a URL in the current tab.',
      inputSchema: z.object({ url: z.string().min(1).max(4096) }),
      execute: async ({ url }) => {
        const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
        if (!/^https?:\/\//i.test(href)) return { ok: false, error: 'Only http(s) pages can be opened.' }
        return run('navigate', `Opened ${href.slice(0, 200)}`, navigateCode(href), 60)
      },
    }),
    click: createTool({
      id: 'click',
      description: 'Click an element by ref (preferred), by its visible text, or at viewport coordinates x/y (CSS pixels, 1280x800 viewport).',
      inputSchema: z.object({
        ref: refSchema.optional(), text: z.string().min(1).max(200).optional(),
        x: z.number().int().min(0).max(4000).optional(), y: z.number().int().min(0).max(4000).optional(),
        double: z.boolean().optional(), label: z.string().max(120).optional().describe('What you are clicking, for the activity log.'),
      }),
      execute: async ({ label, ...input }) => run('click', `Clicked ${label ?? input.text ?? input.ref ?? `${input.x},${input.y}`}`.slice(0, 200), clickCode(input), 30),
    }),
    type_text: createTool({
      id: 'type_text',
      description: 'Type into an input by ref (replaces its value unless clear=false), or into the focused element when no ref is given. submit=true presses Enter afterwards.',
      inputSchema: z.object({
        ref: refSchema.optional(), text: z.string().max(5000), clear: z.boolean().optional(), submit: z.boolean().optional(),
        label: z.string().max(120).optional().describe('Which field, for the activity log.'),
      }),
      execute: async ({ label, ...input }) => run('type_text', `Typed into ${label ?? input.ref ?? 'the focused field'}`.slice(0, 200), typeCode(input), 40),
    }),
    press_key: createTool({
      id: 'press_key',
      description: 'Press a key or chord in the current tab, e.g. "Enter", "Escape", "Tab", "PageDown", "Control+A".',
      inputSchema: z.object({ key: z.string().min(1).max(40) }),
      execute: async ({ key }) => run('press_key', `Pressed ${key}`, pressCode(key), 20),
    }),
    scroll: createTool({
      id: 'scroll',
      description: 'Scroll the page up or down (optionally by pixels), or scroll an element ref into view.',
      inputSchema: z.object({ direction: z.enum(['up', 'down']).default('down'), amount: z.number().int().min(50).max(5000).optional(), ref: refSchema.optional() }),
      execute: async (input) => run('scroll', input.ref ? `Scrolled to ${input.ref}` : `Scrolled ${input.direction}`, scrollCode(input), 20),
    }),
    go_back: createTool({
      id: 'go_back',
      description: 'Go back one page in the current tab.',
      inputSchema: z.object({}),
      execute: async () => run('go_back', 'Went back', backCode(), 30),
    }),
    screenshot: createTool({
      id: 'screenshot',
      description: options.vision
        ? 'Take a screenshot of the current tab to see its layout (images, canvases, visual state). Prefer read_page for text and element refs.'
        : 'Capture a screenshot of the current tab for the record. You cannot see the image; use read_page to inspect the page.',
      inputSchema: z.object({}),
      execute: async () => {
        const outcome = await run('screenshot', 'Took a screenshot', screenshotCode(), 30)
        if (!outcome.ok) return outcome
        const result = (outcome.result ?? {}) as Record<string, unknown>
        const image = typeof result.jpegBase64 === 'string' ? result.jpegBase64 : ''
        return { ok: true, ...pageState(result), bytes: Math.round(image.length * 0.75), ...(options.vision && image ? { jpegBase64: image } : {}) }
      },
      // Images go to the model as media rather than as a giant base64 string.
      toModelOutput: (value: unknown) => {
        const output = (value ?? {}) as Record<string, unknown>
        return typeof output.jpegBase64 === 'string'
          ? { type: 'content', value: [
            { type: 'text', text: JSON.stringify({ ...output, jpegBase64: undefined }) },
            { type: 'media', data: output.jpegBase64, mediaType: 'image/jpeg' },
          ] }
          : { type: 'json', value: output }
      },
    }),
  }
}
