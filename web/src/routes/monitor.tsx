import { createFileRoute } from '@tanstack/react-router'
import { JobMonitor } from '#/components/canvas/job-monitor'

export const Route = createFileRoute('/monitor')({ ssr: false, component: JobMonitor })
