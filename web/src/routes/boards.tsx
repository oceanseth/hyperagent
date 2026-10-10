import { HTreeMark } from '#/components/brand/htree-mark'
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { magicLinkRedirect, safeShareReturn } from '#/lib/share-return'
import { supabase } from '#/utils/supabase'

type Board = { code: string; title: string; role: 'owner' | 'member' }

function Boards() {
  const { error, next } = Route.useSearch()
  const returnTo = useRef(next)
  const arrivedFromAuth = useRef(location.search.includes('code=') || location.hash.includes('access_token='))
  const [account, setAccount] = useState<{ name: string; email: string } | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const renameCancelled = useRef(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // A magic-link / OAuth redirect lands here with ?code=. getSession waits
      // for the PKCE exchange, which writes the sb-* cookies the server reads.
      await supabase.auth.getSession().catch(() => null)
      const destination = returnTo.current
      const kept = destination ? `${location.pathname}?next=${encodeURIComponent(destination)}` : location.pathname
      if (location.search.includes('code=') || location.hash.includes('access_token')) history.replaceState(null, '', kept)
      const response = await fetch('/api/auth/me', { cache: 'no-store' })
      const body = await response.json() as { account: { name: string; email: string } | null }
      if (cancelled) return
      // Only the auth round-trip returns to the shared board. A signed-in
      // visit to Account stays on the board list.
      if (body.account && destination && arrivedFromAuth.current) {
        location.replace(destination)
        return
      }
      setAccount(body.account)
      if (!body.account) { setBoards([]); return }
      const list = await fetch('/api/workspaces', { cache: 'no-store' })
      const data = await list.json() as { boards?: Board[]; error?: string }
      if (cancelled) return
      if (!list.ok) setMessage(data.error ?? 'Could not load your boards.')
      setBoards(data.boards ?? [])
    }
    load().catch(() => { if (!cancelled) { setAccount(null); setBoards([]); setMessage('Could not load your boards.') } })
    return () => { cancelled = true }
  }, [])

  const sendMagicLink = async () => {
    const address = email.trim()
    if (!address || signingIn) return
    setSigningIn(true)
    setMessage(null)
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: magicLinkRedirect(location.origin, returnTo.current) },
    })
    setSigningIn(false)
    if (sendError) setMessage(sendError.message)
    else setLinkSent(true)
  }

  const createBoard = async () => {
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (response.ok) location.href = '/'
    else setMessage('Could not make a board.')
  }

  const rename = async (board: Board, value: string) => {
    setEditing(null)
    const title = value.trim()
    if (renameCancelled.current || !title || title === board.title) return
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', code: board.code, title }),
    })
    const body = await response.json() as { title?: string; error?: string }
    if (!response.ok || !body.title) { setMessage(body.error ?? 'Could not rename that board.'); return }
    setBoards((current) => current?.map((item) => item.code === board.code ? { ...item, title: body.title! } : item) ?? current)
  }

  const field = { height: 44, boxSizing: 'border-box' as const, borderRadius: 8, font: 'inherit' }
  return (
    <main style={{ minHeight: '100dvh', background: '#1b1b1b', color: '#f2f2ed', fontFamily: "'Satoshi', sans-serif", padding: '40px 20px 64px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <a href="/" style={{ color: '#f2f2ed', textDecoration: 'none', fontSize: 22, fontWeight: 650, letterSpacing: '-1px', display: 'inline-flex', alignItems: 'center', gap: 8 }}><HTreeMark size={24} dither />hyperagent</a>
        <h1 style={{ fontSize: 36, letterSpacing: '-1.2px', lineHeight: 1.1, margin: '28px 0 8px' }}>Your boards</h1>
        <p style={{ color: '#b7b7b0', margin: '0 0 20px', lineHeight: 1.45 }}>Each link opens that shared canvas. The title is what social apps show when the link is pasted.</p>
        {error === 'login' && <p style={{ color: '#e7c27a', margin: '0 0 12px' }}>Login did not finish. Try again.</p>}
        {message && <p style={{ color: '#e7c27a', margin: '0 0 12px' }}>{message}</p>}
        {account === undefined && <p style={{ margin: 0 }}>Loading…</p>}
        {account === null && (
          linkSent
            ? <p style={{ margin: 0 }}>{returnTo.current ? 'Check your email — the sign-in link brings you back to the shared board.' : 'Check your email — the sign-in link lands you back here.'}</p>
            : (
              <form onSubmit={(event) => { event.preventDefault(); void sendMagicLink() }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email for sign-in link"
                  style={{ ...field, color: '#f2f2ed', background: '#252623', border: '1px solid #444', padding: '0 12px', flex: '1 1 200px', minWidth: 0 }}
                />
                <button type="submit" disabled={signingIn} style={{ ...field, color: '#1b1b1b', background: '#b4c4a1', border: 0, padding: '0 16px', cursor: signingIn ? 'wait' : 'pointer', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{signingIn ? 'Sending…' : 'Email me a sign-in link'}</button>
              </form>
            )
        )}
        {account && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '18px 0' }}>
              <span style={{ color: '#b7b7b0' }}>{account.name || account.email}</span>
              <span style={{ display: 'flex', gap: 14 }}>
                <button type="button" onClick={() => void createBoard()} style={{ color: '#1b1b1b', background: '#b4c4a1', border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>New board</button>
                <a href="/api/auth/logout" style={{ color: '#b7b7b0' }}>Log out</a>
              </span>
            </div>
            {boards === null && <p>Loading boards…</p>}
            {boards?.length === 0 && <p>No boards yet. Share the canvas you are on, or make a new one.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {boards?.map((board) => (
                <li key={board.code} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', border: '1px solid #333', borderRadius: 12, padding: '14px 16px' }}>
                  <div>
                    {editing === board.code
                      ? <input
                          aria-label="Board name"
                          defaultValue={board.title}
                          maxLength={120}
                          autoFocus
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={(event) => void rename(board, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                            if (event.key === 'Escape') { renameCancelled.current = true; event.currentTarget.blur() }
                          }}
                          style={{ color: '#f2f2ed', background: '#252623', border: '1px solid #444', borderRadius: 8, padding: '4px 8px', font: 'inherit', fontSize: 18, width: '100%' }}
                        />
                      : <a href={`/s/${board.code}`} style={{ color: '#f2f2ed', fontSize: 18, textDecoration: 'none' }}>{board.title}</a>}
                    <div style={{ color: '#8e8e86', fontSize: 13, marginTop: 4 }}>/s/{board.code}</div>
                  </div>
                  {board.role === 'owner' && editing !== board.code && <button type="button" onClick={() => { renameCancelled.current = false; setEditing(board.code) }} style={{ color: '#d7d7d0', background: 'transparent', border: '1px solid #444', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Rename</button>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  )
}

export const Route = createFileRoute('/boards')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error === 'login' ? search.error : undefined,
    next: safeShareReturn(search.next) ?? undefined,
  }),
  ssr: false,
  component: Boards,
})
