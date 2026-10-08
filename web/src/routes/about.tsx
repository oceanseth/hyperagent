import { createFileRoute, Link } from '@tanstack/react-router'

const VIDEO_URL =
  'https://buzz.masky.ai/media/2bfd7282819e7b4178aa28851ebe219cccbd609d11ec9fc63bc617bbaa0223d0.mp4'

export const Route = createFileRoute('/about')({
  ssr: false,
  head: () => ({
    meta: [{ title: 'about — hyperagent' }],
  }),
  component: About,
})

function About() {
  return (
    <main className="min-h-screen bg-[#1b1b1b] text-neutral-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl font-bold tracking-tight">hyperagent</h1>
          <p className="max-w-2xl text-lg text-neutral-400">
            A realtime shared canvas with voice input — discuss anything,
            create agents on the fly, visualize their work and talk it through
            together.
          </p>
        </header>
        <video
          className="w-full rounded-xl border border-neutral-800 shadow-2xl"
          src={VIDEO_URL}
          controls
          playsInline
          preload="metadata"
        />
        <div>
          <Link
            to="/"
            className="inline-block rounded-lg bg-neutral-100 px-5 py-2.5 font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            Open the canvas →
          </Link>
        </div>
      </div>
    </main>
  )
}
