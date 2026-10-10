import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { ArtifactCard } from '#/components/assistant-ui/elements/artifact-card'
import { field, paper } from '#/components/assistant-ui/elements/surfaces'
import { useCanvasNote, useInfiniteCanvas } from '#/hooks/use-infinite-canvas'
import { cn } from '#/lib/utils'
import { BrowserCard } from './browser-card'
import { ResearchCard } from './research-cards'
import { MonitorWidget } from './monitor-widget'
import { WelcomeDialog } from './welcome-dialog'
import { PlanCard, PlanInspector } from './plan-graph'
import { CanvasDock } from './canvas-dock'
import { AgentActivity } from './agent-activity'
import { CursorLayer } from './cursor-layer'
import { PresenceStack } from './presence-stack'
import './canvas.css'

export function InfiniteCanvas({ children }: { children: ReactNode }) {
  const canvas = useInfiniteCanvas()

  return (
    <div className="phab-canvas" data-dragging={canvas.isDragging} {...canvas.canvasProps}>
      <div className="phab-canvas-grid" style={canvas.gridStyle} />

      <div className="phab-canvas-world" style={canvas.worldStyle}>
        <svg className="phab-canvas-connections" aria-hidden="true">{canvas.workspace.connections.map((connection) => <path key={connection.id} d={connection.path} data-kind={connection.kind} />)}</svg>
        <CursorLayer cursors={canvas.workspace.cursors} presence={canvas.workspace.presence} />
        {canvas.items.map((item) => (
          <div className="phab-canvas-object" key={item.id} {...canvas.getItemProps(item)}>
            {item.kind === 'note' && (
              <CanvasNote
                label={item.label}
                text={item.text ?? ''}
                noteProps={canvas.getNoteProps(item)}
                removeProps={canvas.getRemoveNoteProps(item)}
              />
            )}
            {(item.kind === 'source' || item.kind === 'summary') && <ResearchCard item={item} />}
            {(item.kind === 'plan-title' || item.kind === 'plan-node') && <PlanCard item={item} />}
            {item.kind === 'browser' && <BrowserCard item={item} />}
          </div>
        ))}
      </div>

      {canvas.workspace.error && <div className="phab-sync-status" role="status">{canvas.workspace.error}</div>}
      {canvas.selectedPlan && 'plan' in canvas.selectedPlan && <PlanInspector item={canvas.selectedPlan} />}
      <MonitorWidget />
      <WelcomeDialog />

      {canvas.workspace.contextCount > 0 && (
        <span className="phab-context-badge phab-context-badge-float">{canvas.workspace.contextCount} in context</span>
      )}

      {canvas.panel === 'search' && (
        <aside className="phab-canvas-panel phab-search-panel" data-canvas-overlay>
          <div className="phab-search-input"><Search size={16} /><input autoFocus placeholder="Find something in your space…" {...canvas.searchInputProps} /><kbd>esc</kbd></div>
          <div className="phab-panel-list">
            {canvas.filteredItems.map((item) => <button key={item.id} {...canvas.getItemButtonProps(item)}><span className="phab-item-dot" data-kind={item.kind} /><span>{item.label}</span><span className="phab-item-arrow">↗</span></button>)}
            {canvas.filteredItems.length === 0 && <p className="phab-search-empty">Nothing here yet. Try another search.</p>}
          </div>
        </aside>
      )}

      <div className="phab-canvas-base" data-canvas-base data-canvas-overlay>
        <div className="phab-canvas-base-slot">{children}</div>
        {canvas.workspace.loaded && <PresenceStack members={canvas.workspace.presence} selfId={canvas.workspace.selfId} />}
        {canvas.workspace.loaded && <AgentActivity />}
        <CanvasDock canvas={canvas} />
      </div>
    </div>
  )
}

function CanvasNote({
  label,
  text,
  noteProps,
  removeProps,
}: {
  label: string
  text: string
  noteProps: ReturnType<ReturnType<typeof useInfiniteCanvas>['getNoteProps']>
  removeProps: ReturnType<ReturnType<typeof useInfiniteCanvas>['getRemoveNoteProps']>
}) {
  const note = useCanvasNote(label, text)

  return (
    <div className="relative w-[280px]">
      <ArtifactCard {...note.artifactProps} />
      <textarea
        className={cn(
          paper,
          field,
          'mt-2 w-full resize-none rounded-[20px] px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground outline-none',
          note.writing ? 'min-h-28 cursor-text touch-auto' : 'sr-only',
        )}
        {...noteProps}
        {...note.fieldProps}
      />
      <button
        type="button"
        className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-border/60 bg-popover text-foreground/55"
        {...removeProps}
      >
        <X size={12} />
      </button>
    </div>
  )
}
