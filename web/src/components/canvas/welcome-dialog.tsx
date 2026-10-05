import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'

// Same film as /about. The visited flag is written the moment the modal first
// opens, so a refresh or a return visit never replays it.
const VIDEO_URL =
  'https://buzz.masky.ai/media/e635c682fced9856fb1a9d62fa9644bb643d238e17f41d9ac0bf2cd71b598a05.mp4'
const VISITED_KEY = 'hyperagent:visited'

export function WelcomeDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(VISITED_KEY)) return
      localStorage.setItem(VISITED_KEY, new Date().toISOString())
      setOpen(true)
    } catch {
      // Storage unavailable (private mode) — skip the modal rather than show it forever.
    }
  }, [])

  if (!open) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Welcome to hyperagent</DialogTitle>
          <DialogDescription>
            A realtime shared canvas with voice input — discuss anything, create agents
            on the fly, visualize their work and talk it through together. Here is the quick tour:
          </DialogDescription>
        </DialogHeader>
        <video
          src={VIDEO_URL}
          controls
          playsInline
          preload="metadata"
          style={{ width: '100%', borderRadius: 10, background: '#000' }}
        />
        <DialogFooter>
          <a
            href="/about"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#b7b7b0', alignSelf: 'center', marginRight: 'auto', fontSize: 13 }}
          >
            More on the about page ↗
          </a>
          <Button onClick={() => setOpen(false)}>Start exploring</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
