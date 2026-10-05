import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'hyperagent',
      },
      {
        name: 'description',
        content: 'A little space for everything.',
      },
      {
        name: 'theme-color',
        content: '#1b1b1b',
      },
      { property: 'og:title', content: 'hyperagent' },
      { property: 'og:description', content: 'A little space for everything.' },
      { property: 'og:image', content: 'https://hyperagent.lol/og.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://hyperagent.lol/og.png' },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
      { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
})

// Knocks out visitors already on the page once the access gate is up.
const KICK = `(function(){var done=0;function bye(){if(done)return;done=1;document.body.innerHTML='<div style="position:fixed;inset:0;display:grid;place-items:center;background:#1b1b1b;color:#eee;font:18px system-ui">Sorry to see you go.</div>'}
var f=window.fetch;window.fetch=function(){return f.apply(this,arguments).then(function(r){if(r.status===401)bye();return r})};
setInterval(function(){f('/api/auth/me',{cache:'no-store'}).then(function(r){if(r.status===401)bye()}).catch(function(){})},3000)})()`

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: KICK }} />
        <Scripts />
      </body>
    </html>
  )
}
