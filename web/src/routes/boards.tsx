import { HTreeMark } from '#/components/brand/htree-mark'
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '#/utils/supabase'

type Board = { code: string; title: string; role: 'owner' | 'member' }

function Boards() {
  const { error } = Route.useSearch()
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
      if (location.search.includes('code=')) history.replaceState(null, '', location.pathname)
      const response = await fetch('/api/auth/me', { cache: 'no-store' })
      const body = await response.json() as { account: { name: string; email: string } | null }
      if (cancelled) return
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
      options: { emailRedirectTo: `${location.origin}/boards` },
    })
    setSigningIn(false)
    if (sendError) setMessage(sendError.message)
    else setLinkSent(true)
  }

  const githubSignIn = async () => {
    setMessage(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${location.origin}/boards` },
    })
    // On success the browser navigates away; an error usually means the
    // provider is not enabled in the Supabase dashboard yet.
    if (oauthError) setMessage(oauthError.message)
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

  return (
    <main style={{ minHeight: '100dvh', background: '#1b1b1b', color: '#f2f2ed', fontFamily: "'Satoshi', sans-serif", padding: '56px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <a href="/" style={{ color: '#f2f2ed', textDecoration: 'none', fontSize: 22, fontWeight: 650, letterSpacing: '-1px', display: 'inline-flex', alignItems: 'center', gap: 8 }}><HTreeMark size={24} dither />hyperagent</a>
        <h1 style={{ fontSize: 40, letterSpacing: '-1.4px', margin: '28px 0 8px' }}>Your boards</h1>
        <p style={{ color: '#b7b7b0', marginTop: 0 }}>Each link opens that shared canvas. The title is what social apps show when the link is pasted.</p>
        {error === 'login' && <p style={{ color: '#e7c27a' }}>Login did not finish. Try again.</p>}
        {message && <p style={{ color: '#e7c27a' }}>{message}</p>}
        {account === undefined && <p>Loading…</p>}
        {account === null && (
          linkSent
            ? <p>Check your email — the sign-in link lands you back here.</p>
            : (
              <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
                <form onSubmit={(event) => { event.preventDefault(); void sendMagicLink() }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email for sign-in link"
                    style={{ color: '#f2f2ed', background: '#252623', border: '1px solid #444', borderRadius: 8, padding: '10px 12px', font: 'inherit', flex: '1 1 200px' }}
                  />
                  <button type="submit" disabled={signingIn} style={{ color: '#1b1b1b', background: '#b4c4a1', border: 0, padding: '10px 14px', borderRadius: 8, cursor: signingIn ? 'wait' : 'pointer', font: 'inherit' }}>{signingIn ? 'Sending…' : 'Email me a sign-in link'}</button>
                </form>
                <button type="button" onClick={() => void githubSignIn()} style={{ color: '#f2f2ed', background: 'transparent', border: '1px solid #444', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', font: 'inherit', justifySelf: 'start' }}>Sign in with GitHub</button>
              </div>
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
  }),
  ssr: false,
  component: Boards,
})
