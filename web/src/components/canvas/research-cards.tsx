import { TextMessagePartProvider } from '@assistant-ui/react'
import type { ComponentProps } from 'react'
import { ArrowUpRight, CircleAlert, FileText, Layers, Link2, Check, LoaderCircle, X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '#/components/ui/dialog'
import { Image } from '#/components/assistant-ui/elements/image'
import { MarkdownText } from '#/components/assistant-ui/elements/markdown-text'
import { useResearchCard } from '#/hooks/use-canvas-workspace'
import type { CanvasArtifact } from '#/lib/canvas-workspace'
import './research-cards.css'

const markdownComponents = {
  a: (props: ComponentProps<'a'>) => <a className="aui-md-a underline underline-offset-2" {...props} target="_blank" rel="noopener noreferrer" />,
}

export function ResearchCard({ item }: { item: CanvasArtifact }) {
  const card = useResearchCard(item)
  return item.kind === 'summary' ? (
    <article className="phab-research-summary" data-in-context={card.included}>
      <header className="phab-research-heading"><span><Layers size={14} /> CONTEXT STACK</span><span>{card.sourceCountLabel}<button type="button" className="phab-card-remove" {...card.removeProps}><X size={12} /></button></span></header>
      <div className="phab-research-state" data-status={card.status}>{card.working ? <LoaderCircle size={11} className="phab-research-state-spinner" /> : card.failed ? <CircleAlert size={11} /> : <Check size={11} />}{card.statusLabel}</div>
      <h2>{item.label}</h2>
      {card.statusText && <p className="phab-research-status-text">{card.statusText}</p>}
      <div className="phab-research-markdown" {...card.summaryProps}>
        <TextMessagePartProvider text={item.text}><MarkdownText components={markdownComponents} /></TextMessagePartProvider>
      </div>
      <footer className="phab-research-footer">
        <span><Link2 size={12} /> Connected to your sources</span>
        <button {...card.contextProps}>{card.included ? <Check size={12} /> : <Layers size={12} />}{card.contextLabel}</button>
      </footer>
    </article>
  ) : (
    <article className="phab-research-source">
      <header className="phab-research-heading"><span><FileText size={13} />{card.sourceLabel}</span><span>{card.hostname}</span></header>
      {card.source?.imageUrl ? (
        <Image.Root className="phab-research-image" variant="ghost" size="full">
          <Image.Preview src={card.source.imageUrl} alt={item.label} ratio="4:3" fit="cover" loading="lazy" draggable={false} />
        </Image.Root>
      ) : card.pdfPreview ? (
        <div className="phab-research-pdf" {...card.previewProps}><iframe src={card.pdfPreview} title={item.label} loading="lazy" referrerPolicy="no-referrer" tabIndex={-1} /></div>
      ) : (
        <div className="phab-research-excerpt"><FileText size={22} /><p>{item.text || 'Open this source to read the original.'}</p></div>
      )}
      <div className="phab-research-source-title"><h3>{item.label}</h3><a {...card.openProps}><ArrowUpRight size={17} /></a></div>
      <div className="phab-research-source-footer"><span className="phab-research-state" data-status={card.status}>{card.working ? <LoaderCircle size={10} className="phab-research-state-spinner" /> : card.failed ? <CircleAlert size={10} /> : <Check size={10} />}{card.statusLabel}</span><a {...card.openProps}>{card.openLabel} <ArrowUpRight size={12} /></a></div>
      {card.pdfUrl && (
        <div className="contents" {...card.viewerScopeProps}><Dialog {...card.viewerProps}>
          <DialogContent className="phab-pdf-viewer" showCloseButton={false}>
            <header>
              <DialogTitle>{item.label}</DialogTitle>
              <a href={card.pdfUrl} target="_blank" rel="noopener noreferrer">New tab <ArrowUpRight size={12} /></a>
              <DialogClose aria-label="Close PDF"><X size={16} /></DialogClose>
            </header>
            {card.viewerState === 'ready' ? (
              <iframe src={card.pdfUrl} title={item.label} referrerPolicy="no-referrer" />
            ) : (
              <div className="phab-pdf-viewer-note">
                {card.viewerState === 'checking' ? <p>Fetching your PDF… 📄</p> : (
                  <>
                    <span aria-hidden>🙈</span>
                    <p>Oopsie! {card.hostname} is a little shy and won't let us peek at this PDF in here.</p>
                    <a href={card.pdfUrl} target="_blank" rel="noopener noreferrer">Visit it in a new tab instead ✨</a>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog></div>
      )}
    </article>
  )
}
