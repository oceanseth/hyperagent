import type { ReactNode } from 'react'
import { Crosshair, Grid2X2, Minus, PanelLeft, Plus, Search, StickyNote, X } from 'lucide-react'
import { useInfiniteCanvas } from '#/hooks/use-infinite-canvas'
import './canvas.css'

export function InfiniteCanvas({ children }: { children: ReactNode }) {
  const canvas = useInfiniteCanvas()

  return (
    <div className="phab-canvas" data-dragging={canvas.isDragging} {...canvas.canvasProps}>
      <div className="phab-canvas-grid" style={canvas.gridStyle} />

      <header className="phab-canvas-toolbar" data-canvas-overlay>
        <div className="phab-canvas-toolbar-left">
          <a className="phab-wordmark" href="/" aria-label="phab home">
            <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true">
              <path d="M3 20V7.5A5.5 5.5 0 0 1 14 7.5V9a5.5 5.5 0 0 1-11 0" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M10 14.5h7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
            <span>phab</span>
          </a>
          <span className="phab-toolbar-divider" />
          <button className="phab-icon-button" {...canvas.spaceButtonProps}><PanelLeft size={17} strokeWidth={1.5} /></button>
        </div>
        <div className="phab-canvas-toolbar-right">
          <button className="phab-icon-button" {...canvas.overviewButtonProps}><Grid2X2 size={17} strokeWidth={1.5} /></button>
          <button className="phab-icon-button" {...canvas.resetButtonProps}><Crosshair size={19} strokeWidth={1.5} /></button>
          <span className="phab-toolbar-divider" />
          <button className="phab-icon-button" {...canvas.searchButtonProps}><Search size={18} strokeWidth={1.5} /></button>
        </div>
      </header>

      <div className="phab-canvas-world" style={canvas.worldStyle}>
        {canvas.items.map((item) => (
          <div className="phab-canvas-object" key={item.id} {...canvas.getItemProps(item)}>
            {item.kind === 'clock' && (
              <div className="phab-clock" title={canvas.timeLabel}>
                <svg className="phab-clock-face" viewBox="0 0 120 120" fill="none" aria-hidden="true">
                  <circle cx="60" cy="60" r="59" fill="#F5F5F2" />
                  {canvas.clockTicks.map((tick) => <path key={tick.id} d={tick.path} transform={tick.transform} opacity={tick.opacity} stroke="#333431" strokeWidth="1" />)}
                </svg>
                <span className="phab-clock-hand phab-clock-hour" style={canvas.hourStyle} />
                <span className="phab-clock-hand phab-clock-minute" style={canvas.minuteStyle} />
                <span className="phab-clock-hand phab-clock-second" style={canvas.secondStyle} />
                <span className="phab-clock-pin" />
                <span className="phab-sr-only">{canvas.timeLabel}</span>
              </div>
            )}
            {item.kind === 'note' && (
              <div className="phab-sticky-note">
                <div className="phab-note-heading"><span>{item.label}</span><button {...canvas.getRemoveNoteProps(item)}><X size={13} /></button></div>
                <textarea {...canvas.getNoteProps(item)} />
              </div>
            )}
          </div>
        ))}
      </div>

      {canvas.panel === 'space' && (
        <aside className="phab-canvas-panel phab-space-panel" data-canvas-overlay>
          <div className="phab-panel-eyebrow">YOUR SPACE</div>
          <h2>A place for your ideas.</h2>
          <p>Make a little room for whatever comes next.</p>
          <button className="phab-add-note" {...canvas.addNoteProps}><Plus size={15} /> Add a note</button>
          <div className="phab-panel-list">
            {canvas.items.map((item) => <button key={item.id} {...canvas.getItemButtonProps(item)}><span className="phab-item-dot" data-kind={item.kind} /><span>{item.label}</span><span className="phab-item-arrow">↗</span></button>)}
          </div>
          <div className="phab-panel-footnote">Drag to explore. Pinch to zoom.</div>
        </aside>
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

      {canvas.panel === 'overview' && (
        <aside className="phab-canvas-panel phab-overview-panel" data-canvas-overlay>
          <div className="phab-panel-eyebrow">YOUR CANVAS</div>
          <div className="phab-mini-map">{canvas.items.map((item) => <button key={item.id} className="phab-mini-map-dot" data-kind={item.kind} {...canvas.getOverviewItemProps(item)} />)}</div>
          <p>Choose an object to jump to it.</p>
        </aside>
      )}

      <div className="phab-canvas-zoom" data-canvas-overlay>
        <button className="phab-icon-button phab-quick-note" title="Add a note" aria-label="Add a note" {...canvas.addNoteProps}><StickyNote size={15} /></button>
        <span className="phab-toolbar-divider" />
        <button className="phab-icon-button" {...canvas.zoomOutProps}><Minus size={14} /></button>
        <button className="phab-zoom-value" {...canvas.resetButtonProps}>{canvas.zoomLabel}</button>
        <button className="phab-icon-button" {...canvas.zoomInProps}><Plus size={14} /></button>
      </div>
      <div className="phab-canvas-overlays" data-canvas-overlay>{children}</div>
    </div>
  )
}
