import { createFileRoute } from '@tanstack/react-router'
import { Assistant } from '#/assistant'

export const Route = createFileRoute('/')({ ssr: false, component: Assistant })
