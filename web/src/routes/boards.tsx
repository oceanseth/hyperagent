import { HTreeMark } from '#/components/brand/htree-mark'
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

type Board = { code: string; title: string; role: 'owner' | 'member' }
type FirebaseConfig = { apiKey: string; authDomain: string }

const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/11.6.0'

async function googleSignIn(config: FirebaseConfig) {
  const [appModule, authModule] = await Promise.all([
    import(/* @vite-ignore */ `${FIREBASE_CDN}/firebase-app.js`),
    import(/* @vite-ignore */ `${FIREBASE_CDN}/firebase-auth.js`),
  ])
  const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(config)
  const auth = authModule.getAuth(app)
  const credential = await authModule.signInWithPopup(auth, new authModule.GoogleAuthProvider())
  return credential.user.getIdToken() as Promise<string>
}

function Boards() {
  const { error } = Route.useSearch()
  const [account, setAccount] = useState<{ name: string; email: string } | null | undefined>(undefined)
  const [configured, setConfigured] = useState(true)
  const [firebase, setFirebase] = useState<FirebaseConfig | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const renameCancelled = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ account: { name: string; email: string } | null; configured?: boolean; firebase?: FirebaseConfig }>)
      .then(async (body) => {
        if (cancelled) return
        setAccount(body.account)
        setConfigured(body.configured !== false)
        setFirebase(body.firebase ?? null)
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

  const signIn = async () => {
    if (!firebase || signingIn) return
    setSigningIn(true)
    setMessage(null)
    try {
      const idToken = await googleSignIn(firebase)
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const body = await response.json() as { account?: { name: string; email: string }; error?: string }
      if (!response.ok || !body.account) { setMessage(body.error ?? 'Login did not finish. Try again.'); return }
      location.reload()
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setMessage('Login did not finish. Try again.')
    } finally {
      setSigningIn(false)
    }
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
        {error === 'config' && <p style={{ color: '#e7c27a' }}>Login is not configured on this server yet. It needs SESSION_SECRET.</p>}
        {error === 'login' && <p style={{ color: '#e7c27a' }}>Login did not finish. Try again.</p>}
        {message && <p style={{ color: '#e7c27a' }}>{message}</p>}
        {account === undefined && <p>Loading…</p>}
        {account === null && (
          configured && firebase
            ? <button type="button" onClick={() => void signIn()} disabled={signingIn} style={{ color: '#1b1b1b', background: '#b4c4a1', border: 0, padding: '10px 14px', borderRadius: 8, cursor: signingIn ? 'wait' : 'pointer', font: 'inherit', display: 'inline-block' }}>{signingIn ? 'Signing in…' : 'Sign in with Google'}</button>
            : <p style={{ color: '#e7c27a' }}>Login is not configured on this server yet.</p>
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
    error: search.error === 'config' || search.error === 'login' ? search.error : undefined,
  }),
  ssr: false,
  component: Boards,
})
