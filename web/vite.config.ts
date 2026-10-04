import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      compatibilityDate: '2026-10-04',
      // The browser export of pkce-challenge uses Workers' Web Crypto API.
      exportConditions: ['browser'],
      cloudflare: {
        deployConfig: true,
        nodeCompat: true,
        wrangler: { name: 'phab', workers_dev: true },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
