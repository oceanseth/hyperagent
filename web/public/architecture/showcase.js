const repository = 'https://github.com/oceanseth/hyperagent/blob/main/'
const partners = {
  assistant: {
    name: 'Assistant UI', role: 'The conversation becomes a workspace.', component: 'thread-aui', url: 'https://www.assistant-ui.com/',
    description: 'Streams, tool calls, reasoning, attachments and Markdown belong in the conversation. Assistant UI supplies the primitives that make the agent’s output usable on the canvas.',
    evidence: [['Message renderer', 'web/src/components/assistant-ui/elements/thread.aui.tsx'], ['Assistant runtime', 'web/src/assistant.tsx']],
  },
  neon: {
    name: 'Neon', role: 'The state and intelligence behind the board.', component: 'canvas-db', url: 'https://neon.com/',
    description: 'Postgres holds shared boards, source stacks, jobs and execution leases. Neon AI Gateway supplies inference to the assistant, research and browser agents. The workspace survives an individual browser tab.',
    evidence: [['Durable workspace and jobs', 'web/src/server/canvas-db.ts'], ['AI Gateway adapter', 'web/src/mastra/gateway.ts']],
  },
  executor: {
    name: 'Executor', role: 'A connected toolbelt for every agent.', component: 'mcp', url: 'https://executor.sh/',
    description: 'The agents discover connected services through one MCP gateway. Exa search and KERNEL browser operations are resolved at runtime, so a renamed or added connection does not need an app redeploy.',
    evidence: [['Tool discovery and lifecycle', 'web/src/server/mcp.ts'], ['Assistant tool assembly', 'web/src/server/assistant-tools.ts']],
  },
  agentmail: {
    name: 'AgentMail', role: 'Give each agent an address.', component: 'server-agentmail', url: 'https://www.agentmail.to/',
    description: 'Configured workspaces can provision or reuse a named inbox for each agent. The adapter includes message-reading and sending helpers, and reports inbox provisioning failures individually.',
    evidence: [['Inbox provisioning and mail helpers', 'web/src/server/agentmail.ts'], ['Workspace inbox endpoint', 'web/src/routes/api/agentmail.ts']],
  },
  mastra: {
    name: 'Mastra', role: 'Specialized agents. A coherent conversation.', component: 'agents-assistant', url: 'https://mastra.ai/',
    description: 'Mastra coordinates the conversational assistant, research sidecar and background agents. Step callbacks feed the app’s activity log; an optional Memory Gateway supplies earlier formation context.',
    evidence: [['Conversational assistant', 'web/src/mastra/agents/assistant.ts'], ['Research agent and step events', 'web/src/server/research.ts'], ['Optional formation memory', 'web/src/server/mastra-memory.ts']],
  },
  exa: {
    name: 'Exa', role: 'Research starts with real evidence.', component: 'web-search', url: 'https://exa.ai/',
    description: 'The search adapter discovers Exa through Executor and preserves result URLs and highlight excerpts. Sources appear progressively on the canvas, with citations that users can open and reuse.',
    evidence: [['Live search and source extraction', 'web/src/server/web-search.ts'], ['Incremental source publishing', 'web/src/server/research.ts']],
  },
  fly: {
    name: 'Fly.io', role: 'The work continues when the tab closes.', component: 'worker-index', url: 'https://fly.io/',
    description: 'A separate Fly.io Machine runs research and browser jobs from the Neon queue. It supports two concurrent jobs, checks for queued work, recovers expired leases and drains active work on shutdown.',
    evidence: [['Independent job runner', 'web/worker/index.ts'], ['Fly.io deployment', 'web/fly.toml']],
  },
  kernel: {
    name: 'KERNEL', role: 'A browser the team and agent can share.', component: 'kernel-browser', url: 'https://www.kernel.sh/',
    description: 'KERNEL cloud browsers appear as live cards on the shared board. Agents read, click and type in the same session through Playwright Execution, while teammates watch and retain the surrounding context.',
    evidence: [['Cloud browser lifecycle', 'web/src/server/kernel-browser.ts'], ['Browser execution skills', 'web/src/server/browser-skills.ts'], ['Shared live-view card', 'web/src/components/canvas/browser-card.tsx']],
  },
}
const tours = {
  research: {
    id: 'from-question-to-cited-canvas', index: '01', title: 'From question to cited canvas.',
    description: 'Research keeps running while the conversation continues. Follow a request through the stack and back to the board.',
    evidence: [['Research worker', 'web/src/server/research.ts'], ['Durable job store', 'web/src/server/canvas-db.ts']],
  },
  browser: {
    id: 'watch-an-agent-use-the-browser', index: '02', title: 'Watch an agent use the browser.',
    description: 'The agent acts in the same cloud browser everyone sees. Follow a task from a shared card to the worker and back.',
    evidence: [['Browser agent', 'web/src/server/browser-agent.ts'], ['Live browser lifecycle', 'web/src/server/browser-canvas.ts']],
  },
  inference: {
    id: 'one-gateway-for-agent-inference', index: '03', title: 'One gateway for agent inference.',
    description: 'Assistant UI presents the conversation. Mastra orchestrates the turn. Neon AI Gateway supplies the inference behind it.',
    evidence: [['Model adapter', 'web/src/mastra/gateway.ts'], ['Streaming chat endpoint', 'web/src/routes/api/chat.ts']],
  },
}
const byId = (id) => document.getElementById(id)
const frame = byId('architecture-map')
let ready = false
let manifest
let currentTour = 'research'
let currentStep = 0
let selectedPartner = null
let currentView = '?hud=off&flow=from-question-to-cited-canvas&step=1'

function sendView(query) {
  currentView = query
  const full = new URL('./map/index.html', location.href)
  full.search = query
  full.searchParams.delete('hud')
  full.searchParams.set('theme', 'dark')
  byId('full-map').href = full.href
  if (ready) frame.contentWindow.postMessage({ gromaView: query }, location.origin)
}
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.gromaReady !== true) return
  ready = true
  byId('map-status').textContent = 'Architecture ready · explore any component'
  sendView(currentView)
})

function evidenceLinks(items) {
  byId('evidence-links').replaceChildren(...items.map(([label, file]) => {
    const a = document.createElement('a')
    a.href = repository + file.split('/').map(encodeURIComponent).join('/')
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = `${label} ↗`
    return a
  }))
}
function selections() {
  document.querySelectorAll('[data-partner]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.partner === selectedPartner)))
  document.querySelectorAll('[data-tour]').forEach((button) => button.setAttribute('aria-pressed', String(!selectedPartner && button.dataset.tour === currentTour)))
}
function showPartner(key) {
  const partner = partners[key]
  selectedPartner = key
  selections()
  byId('guide-kicker').textContent = `INTEGRATION / ${partner.name}`
  byId('guide-title').textContent = partner.role
  byId('guide-description').textContent = partner.description
  byId('step-card').hidden = true
  byId('step-controls').hidden = true
  evidenceLinks(partner.evidence)
  const link = byId('provider-link')
  link.hidden = false
  link.href = partner.url
  link.target = '_blank'
  link.rel = 'noopener'
  link.textContent = `Visit ${partner.name} ↗`
  sendView(`?hud=off&component=${encodeURIComponent(partner.component)}`)
}
function showTour(key, step = 0) {
  const tour = tours[key]
  const steps = manifest?.flows[tour.id]?.steps ?? []
  currentTour = key
  currentStep = Math.max(0, Math.min(step, Math.max(0, steps.length - 1)))
  selectedPartner = null
  selections()
  byId('guide-kicker').textContent = `GUIDED FLOW / ${tour.index}`
  byId('guide-title').textContent = tour.title
  byId('guide-description').textContent = tour.description
  byId('step-card').hidden = false
  byId('step-controls').hidden = false
  byId('provider-link').hidden = true
  byId('step-number').textContent = steps.length ? `STEP ${String(currentStep + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}` : 'GUIDED FLOW'
  byId('step-copy').textContent = steps[currentStep]?.action ?? 'Open the full architecture map to follow this flow.'
  byId('step-progress').textContent = steps.length && currentStep === steps.length - 1 ? 'Flow complete' : 'Follow the request'
  byId('previous').disabled = !steps.length || currentStep === 0
  byId('next').disabled = !steps.length || currentStep === steps.length - 1
  evidenceLinks(tour.evidence)
  sendView(`?hud=off&flow=${tour.id}&step=${currentStep + 1}`)
}
function scrollToMap() {
  byId('explore').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
}
document.querySelectorAll('[data-partner]').forEach((button) => button.addEventListener('click', () => { showPartner(button.dataset.partner); scrollToMap() }))
document.querySelectorAll('[data-tour]').forEach((button) => button.addEventListener('click', () => showTour(button.dataset.tour)))
document.querySelectorAll('[data-start-tour]').forEach((button) => button.addEventListener('click', () => { showTour(button.dataset.startTour); scrollToMap() }))
document.querySelectorAll('[data-start-partner]').forEach((button) => button.addEventListener('click', () => { showPartner(button.dataset.startPartner); scrollToMap() }))
byId('previous').addEventListener('click', () => showTour(currentTour, currentStep - 1))
byId('next').addEventListener('click', () => showTour(currentTour, currentStep + 1))
fetch('./flow-manifest.json').then((response) => {
  if (!response.ok) throw new Error('Architecture manifest unavailable')
  return response.json()
}).then((value) => {
  manifest = value
  if (!selectedPartner) showTour(currentTour, currentStep)
}).catch(() => {
  if (!selectedPartner) showTour(currentTour)
  byId('map-status').textContent = 'Guided steps unavailable · open the full map'
})
