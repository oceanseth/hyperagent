import { HTreeMark } from '#/components/brand/htree-mark'
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

type Board = { code: string; title: string; role: 'owner' | 'member' }

function Boards() {
  const { error } = Route.useSearch()
  const [account, setAccount] = useState<{ name: string; email: string } | null | undefined>(undefined)
  const [configured, setConfigured] = useState(true)
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ account: { name: string; email: string } | null; configured?: boolean }>)
      .then(async (body) => {
        if (cancelled) return
        setAccount(body.account)
        setConfigured(body.configured !== false)
        if (!body.account) { setBoards([]); return }
        const list = await fetch('/api/workspaces', { cache: 'no-store' })
        const data = await list.json() as { boards?: Board[]; error?: string }
        if (cancelled) return
        if (!list.ok) setMessage(data.error ?? 'Could not load your boards.')
        setBoards(data.boards ?? [])
      })
      .catch(() => { if (!cancelled) { setAccount(null); setBoards([]); setMessage('Could not load your boards.') } })
    return () => { cancelled = true }
  }, [])

  const createBoard = async () => {
    const title = window.prompt('Name this board', 'Untitled board')
    if (title === null) return
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (response.ok) location.href = '/'
    else setMessage('Could not make a board.')
  }

  const rename = async (board: Board) => {
    const title = window.prompt('Rename this board', board.title)
    if (title === null) return
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
        <a href="/" style={{ color: '#f2f2ed', textDecoration: 'none', fontSize: 22, fontWeight: 650, letterSpacing: '-1px', display: 'inline-flex', alignItems: 'center', gap: 8 }}><HTreeMark size={24} />hyperagent</a>
        <h1 style={{ fontSize: 40, letterSpacing: '-1.4px', margin: '28px 0 8px' }}>Your boards</h1>
        <p style={{ color: '#b7b7b0', marginTop: 0 }}>Each link opens that shared canvas. The title is what social apps show when the link is pasted.</p>
        {error === 'config' && <p style={{ color: '#e7c27a' }}>Auth0 is not configured on this server yet. It needs AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_SECRET or AUTH0_CLIENT_SECRET. The callback URL is /api/auth/callback.</p>}
        {error === 'login' && <p style={{ color: '#e7c27a' }}>Login did not finish. Try again.</p>}
        {message && <p style={{ color: '#e7c27a' }}>{message}</p>}
        {account === undefined && <p>Loading…</p>}
        {account === null && (
          configured
            ? <a href="/api/auth/login" style={{ color: '#1b1b1b', background: '#b4c4a1', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', display: 'inline-block' }}>Log in with Auth0</a>
            : <p style={{ color: '#e7c27a' }}>Auth0 is not configured on this server yet.</p>
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
                    <a href={`/s/${board.code}`} style={{ color: '#f2f2ed', fontSize: 18, textDecoration: 'none' }}>{board.title}</a>
                    <div style={{ color: '#8e8e86', fontSize: 13, marginTop: 4 }}>/s/{board.code}</div>
                  </div>
                  {board.role === 'owner' && <button type="button" onClick={() => void rename(board)} style={{ color: '#d7d7d0', background: 'transparent', border: '1px solid #444', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Rename</button>}
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
    error: search.error === 'config' || search.error === 'login' ? search.error : undefined,
  }),
  ssr: false,
  component: Boards,
})
