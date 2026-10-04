import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { Check, ChevronRight, CircleAlert, GitBranch, LoaderCircle, Lock, Share2 } from 'lucide-react'
import { canvasWorkspace, refreshCanvas, toggleOpenPlan, type PlanArtifact } from '#/lib/canvas-workspace'
import type { Plan, PlanDocument, PlanNode } from '#/lib/plan'
import './plan-graph.css'

async function planRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Could not update this plan.')
  await refreshCanvas()
  return payload
}

function stop(event: PointerEvent<HTMLElement>) {
  event.stopPropagation()
}

export function PlanCard({ item }: { item: PlanArtifact }) {
  if (item.kind === 'plan-title') {
    const blocked = item.plan.states.filter((node) => node.status === 'blocked').length
    return (
      <article className="phab-plan-title" data-canvas-content>
        <header><span><GitBranch size={13} /> PLAN</span><span>{item.plan.states.length} states</span></header>
        <h2>{item.label}</h2>
        {item.text && <p>{item.text}</p>}
        <footer>
          <span>{blocked ? `${blocked} blocked` : 'Ready to walk'}</span>
          {item.plan.published && <span className="phab-plan-share">/p/{item.plan.published.slug}</span>}
        </footer>
      </article>
    )
  }
  const node = item.node!
  const open = useSyncExternalStore(
    canvasWorkspace.subscribe,
    () => Boolean(node.childPlanId && canvasWorkspace.getState().openPlanIds.includes(node.childPlanId)),
    () => false,
  )
  return (
    <article className="phab-plan-node" data-status={node.status} data-canvas-content>
      <header>
        <span data-status={node.status}>{statusIcon(node.status)}{node.status}</span>
        {node.childPlanId && <span>inner machine</span>}
      </header>
      <h3>{node.name}</h3>
      <p>{summary(node)}</p>
      {node.childPlanId && (
        <button type="button" onPointerDown={stop} onClick={() => toggleOpenPlan(node.childPlanId!)}>
          {open ? 'Hide inner machine' : 'Open inner machine'} <ChevronRight size={12} />
        </button>
      )}
    </article>
  )
}

export function PlanInspector({ item }: { item: PlanArtifact }) {
  const plan = item.plan
  const node = item.kind === 'plan-node' ? item.node : undefined
  return (
    <aside className="phab-canvas-panel phab-plan-panel" data-canvas-overlay>
      <div className="phab-panel-eyebrow">{item.kind === 'plan-title' ? 'PLAN' : 'STATE'}</div>
      <h2>{node?.name ?? plan.name}</h2>
      <p>{node ? 'Edit the agent-written context, confirm guesses, then run this state.' : plan.description || 'Publish this plan, or click a state to inspect it.'}</p>
      {node ? <NodeEditor plan={plan} node={node} /> : <PlanPublish plan={plan} />}
    </aside>
  )
}

function NodeEditor({ plan, node }: { plan: Plan; node: PlanNode }) {
  const [context, setContext] = useState(node.context)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saveContext = async () => {
    setBusy(true); setError(null)
    try { await planRequest({ action: 'patch', planId: plan.id, nodeId: node.id, context }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  const confirm = async (key: string) => {
    setError(null)
    try { await planRequest({ action: 'patch', planId: plan.id, nodeId: node.id, confirmField: key }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not confirm.') }
  }
  const answer = async (questionId: string, value: string) => {
    if (!value.trim()) return
    try { await planRequest({ action: 'patch', planId: plan.id, nodeId: node.id, questionId, answer: value }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the answer.') }
  }
  const run = async () => {
    setBusy(true); setError(null)
    try { await planRequest({ action: 'execute', planId: plan.id, nodeId: node.id }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run this state.') }
    finally { setBusy(false) }
  }
  return (
    <div className="phab-plan-editor">
      <label>
        Context
        <textarea value={context} onChange={(event) => setContext(event.target.value)} onPointerDown={stop} rows={8} />
      </label>
      <button type="button" className="phab-plan-secondary" disabled={busy || context === node.context} onPointerDown={stop} onClick={() => void saveContext()}>Save context</button>
      {node.fields.length > 0 && (
        <section>
          <h3>Fields</h3>
          {node.fields.map((field) => (
            <div key={field.key} className="phab-plan-field">
              <div>
                <strong>{field.label}</strong>
                <span>{field.secret && field.value ? 'stored token only' : (field.value || 'empty')}{field.guessed && !field.confirmed ? ' · guessed' : ''}</span>
                {!field.confirmed && (
                  <input
                    type={field.secret ? 'password' : 'text'}
                    defaultValue={field.secret ? '' : (field.value ?? '')}
                    placeholder={field.secret ? 'Paste key — stored server-side' : 'Type to fill this field'}
                    onPointerDown={stop}
                    onBlur={(event) => {
                      const value = event.target.value.trim()
                      if (!value || value === field.value) return
                      void planRequest({ action: 'patch', planId: plan.id, nodeId: node.id, fieldKey: field.key, fieldValue: value })
                        .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not save the field.'))
                    }}
                  />
                )}
              </div>
              <button type="button" disabled={field.confirmed || !field.value} onPointerDown={stop} onClick={() => void confirm(field.key)}>
                {field.confirmed ? <Check size={12} /> : null}{field.confirmed ? 'Confirmed' : 'Confirm'}
              </button>
            </div>
          ))}
        </section>
      )}
      {node.executeHint === 'save-card' && <CardForm />}
      {node.questions.length > 0 && (
        <section>
          <h3>Unresolved questions</h3>
          {node.questions.map((question) => (
            <label key={question.id}>
              {question.text}
              <input defaultValue={question.answer ?? ''} placeholder="Answer to unblock" onPointerDown={stop} onBlur={(event) => void answer(question.id, event.target.value)} />
            </label>
          ))}
        </section>
      )}
      {node.documents.length > 0 && <DocumentList documents={node.documents} />}
      <button type="button" className="phab-plan-run" disabled={busy || node.status !== 'ready'} onPointerDown={stop} onClick={() => void run()}>
        {busy ? <LoaderCircle size={14} className="phab-research-state-spinner" /> : <Lock size={14} />}
        {node.status === 'ready' ? 'Run this state' : node.status === 'done' ? 'Already done' : 'Blocked until confirmed'}
      </button>
      {error && <p className="phab-plan-error" role="alert">{error}</p>}
    </div>
  )
}

function PlanPublish({ plan }: { plan: Plan }) {
  const [label, setLabel] = useState(plan.published?.label ?? plan.name)
  const [description, setDescription] = useState(plan.published?.description ?? plan.description)
  const [url, setUrl] = useState(plan.published ? `${location.origin}/p/${plan.published.slug}` : '')
  const [error, setError] = useState<string | null>(null)
  const publish = async () => {
    setError(null)
    try {
      const result = await planRequest({ action: 'publish', planId: plan.id, label, description }) as { url?: string }
      const share = result.url ? `${location.origin}${result.url}` : url
      setUrl(share)
      await navigator.clipboard?.writeText(share).catch(() => undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish.')
    }
  }
  return (
    <div className="phab-plan-editor">
      <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} onPointerDown={stop} /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} onPointerDown={stop} rows={4} /></label>
      <button type="button" className="phab-plan-run" onPointerDown={stop} onClick={() => void publish()}><Share2 size={14} /> Publish this level</button>
      {url && <p className="phab-plan-share-url">{url}</p>}
      {error && <p className="phab-plan-error" role="alert">{error}</p>}
      <DocumentList documents={plan.states.flatMap((node) => node.documents)} />
    </div>
  )
}

function CardForm() {
  const [methods, setMethods] = useState<Array<{ payableId: string; brand: string; last4: string; exp: string }>>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    fetch('/api/plans', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ connected?: boolean; methods?: Array<{ payableId: string; brand: string; last4: string; exp: string }> }>)
      .then((payload) => {
        setConnected(Boolean(payload.connected))
        setMethods(payload.methods ?? [])
        setSelected(payload.methods?.[0]?.payableId ?? '')
      })
      .catch(() => setConnected(false))
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const method = methods.find((entry) => entry.payableId === selected)
    if (!method) { setError('Pick a Northwest card. Add one in their portal if the list is empty.'); return }
    setError(null)
    try {
      await planRequest({ action: 'save-card', brand: method.brand, last4: method.last4, exp: method.exp, payableId: method.payableId })
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not bind the card.')
    }
  }
  return (
    <form className="phab-plan-card" onSubmit={(event) => void submit(event)} onPointerDown={stop}>
      <h3>Bind Northwest card</h3>
      <p>Checkout charges a card already saved at Northwest. This app never collects a PAN.</p>
      {connected === false && <p className="phab-plan-error">Northwest is not connected on the worker. Set NORTHWEST_ACCESS_TOKEN.</p>}
      {connected && methods.length === 0 && <p>No cards on the Northwest account. Add one in their portal, then reopen this state.</p>}
      {methods.length > 0 && (
        <label>
          Payment method
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {methods.map((method) => (
              <option key={method.payableId} value={method.payableId}>{method.brand} •••• {method.last4}</option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={!selected}>Bind this card</button>
      {saved && <p>Card bound. Confirm last four, then run this state.</p>}
      {error && <p className="phab-plan-error">{error}</p>}
    </form>
  )
}

function DocumentList({ documents }: { documents: PlanDocument[] }) {
  if (!documents.length) return null
  return (
    <section>
      <h3>Vault</h3>
      {documents.map((document) => (
        <article key={document.id} className="phab-plan-doc">
          <strong>{document.title}</strong>
          <pre>{document.markdown}</pre>
        </article>
      ))}
    </section>
  )
}

function summary(node: PlanNode) {
  const questions = node.questions.filter((question) => question.blocking && !question.answer).length
  const fields = node.fields.filter((field) => field.required && !field.confirmed).length
  if (node.status === 'done') return node.documents.length ? `${node.documents.length} document${node.documents.length === 1 ? '' : 's'} in the vault` : 'Complete'
  if (questions || fields) return `${fields} field${fields === 1 ? '' : 's'} to confirm · ${questions} question${questions === 1 ? '' : 's'}`
  return 'Ready when prior states are done'
}

function statusIcon(status: PlanNode['status']) {
  if (status === 'running') return <LoaderCircle size={11} className="phab-research-state-spinner" />
  if (status === 'failed') return <CircleAlert size={11} />
  if (status === 'done') return <Check size={11} />
  return null
}
