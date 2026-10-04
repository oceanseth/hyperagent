import { createFileRoute } from '@tanstack/react-router'
import { Assistant } from '#/assistant'

export const Route = createFileRoute('/p/$slug')({ ssr: false, component: Assistant })
