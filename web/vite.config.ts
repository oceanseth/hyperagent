import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Deploys as a plain Node server (NITRO_PRESET=node_server) in a container on
// AWS App Runner behind the hyperagent.lol CloudFront distribution.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      compatibilityDate: '2026-10-04',
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
