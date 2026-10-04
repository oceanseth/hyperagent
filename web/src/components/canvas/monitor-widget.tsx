import { Activity, ArrowUpRight, ChevronDown, Copy } from 'lucide-react'
import { useDebugReport } from '#/hooks/use-debug-report'
import { useJobMonitor } from '#/hooks/use-job-monitor'
import './job-monitor.css'

export function MonitorWidget() {
  const monitor = useJobMonitor()
  const report = useDebugReport()
  return (
    <aside className="phab-monitor-widget" data-canvas-overlay aria-label="Research monitor">
      <details {...monitor.widgetProps}>
        <summary><Activity size={14} /><strong>Activity</strong><span>{monitor.counts.active} active</span><ChevronDown size={14} /></summary>
        <div className="phab-monitor-widget-body">
          {monitor.error && <p className="phab-monitor-widget-warning">{monitor.error}</p>}
          {monitor.loading && <p>Loading research activity…</p>}
          {!monitor.loading && monitor.widgetJobs.length === 0 && <p>No research jobs yet.</p>}
          {monitor.widgetJobs.map((job) => <a className="phab-monitor-widget-job" key={job.id} href={job.monitorHref} target="_blank" rel="noopener noreferrer"><span className="phab-monitor-status" data-status={job.status}>{job.statusLabel} · {job.elapsedLabel}</span><strong>{job.title}</strong><span>{job.progress}</span><span className="phab-monitor-widget-meta">{job.workerLabel} · heartbeat {job.heartbeatLabel}</span>{job.latestEvent && <span className="phab-monitor-widget-event">{job.latestEvent}</span>}{job.warning && <span className="phab-monitor-widget-warning">{job.warning}</span>}</a>)}
          <div className="phab-monitor-widget-actions"><button {...report.copyProps}><Copy size={13} />{report.label}</button><a href="/monitor" target="_blank" rel="noopener noreferrer">Open monitor <ArrowUpRight size={12} /></a></div>
          {report.status && <p className="phab-monitor-copy-status" role="status">{report.status}</p>}
          {report.fallback && <textarea className="phab-monitor-report" {...report.fallbackProps} />}
        </div>
      </details>
    </aside>
  )
}
