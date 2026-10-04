import { Activity, ArrowLeft, ArrowUpRight, ChevronDown, CircleAlert, Clock3, Copy, MapPin, RefreshCw, Server } from 'lucide-react'
import { paper } from '#/components/assistant-ui/elements/surfaces'
import { useJobMonitor } from '#/hooks/use-job-monitor'
import { useDebugReport } from '#/hooks/use-debug-report'
import { cn } from '#/lib/utils'
import './job-monitor.css'

export function JobMonitor() {
  const monitor = useJobMonitor()
  const report = useDebugReport()
  return (
    <main className="phab-monitor">
      <header className="phab-monitor-header">
        <a href="/" className="phab-monitor-back"><ArrowLeft size={16} /> Back to canvas</a>
        <div className="phab-monitor-sync"><span>{monitor.syncLabel}</span><button {...monitor.refreshProps}><RefreshCw size={14} />{monitor.refreshLabel}</button><button {...report.copyProps}><Copy size={14} />{report.label}</button></div>
      </header>
      <section className="phab-monitor-intro">
        <span className="phab-monitor-eyebrow"><Activity size={15} /> WORKSPACE ACTIVITY</span>
        <h1>Follow the work.</h1>
        <p>Live research progress, worker health, and the steps behind every result.</p>
        <div className="phab-monitor-stats"><span><strong>{monitor.counts.active}</strong> active</span><span><strong>{monitor.counts.completed}</strong> completed</span><span><strong>{monitor.counts.failed}</strong> failed</span><span><strong>{monitor.counts.cancelled}</strong> cancelled</span></div>
      </section>
      {monitor.error && <div className="phab-monitor-alert" role="status"><CircleAlert size={17} />{monitor.error} Showing the last received status.</div>}
      {report.status && <p className="phab-monitor-copy-status" role="status">{report.status}</p>}
      {report.fallback && <textarea className="phab-monitor-report" {...report.fallbackProps} />}
      <nav className="phab-monitor-filters" aria-label="Filter research jobs">{monitor.filters.map((filter) => <button key={filter.id} {...filter.props}>{filter.label}<span>{filter.count}</span></button>)}</nav>
      {monitor.loading && <p className="phab-monitor-empty" role="status">Loading your research jobs…</p>}
      {!monitor.loading && monitor.jobs.length === 0 && <p className="phab-monitor-empty">{monitor.emptyLabel}</p>}
      <div className="phab-monitor-jobs">
        {monitor.jobs.map((job) => (
          <details className={cn(paper, 'phab-monitor-job')} key={job.id} {...monitor.getJobProps(job)}>
            <summary className="phab-monitor-job-summary">
              <span className="phab-monitor-job-main"><span className="phab-monitor-status" data-status={job.status}>{job.statusLabel}</span><strong>{job.title}</strong><span className="phab-monitor-progress">{job.progress}</span></span>
              <span className="phab-monitor-summary-meta"><span><Clock3 size={13} />{job.elapsedLabel}</span><span>{job.eventLabel}</span><ChevronDown className="phab-monitor-chevron" size={17} /></span>
            </summary>
            <div className="phab-monitor-job-content">
              {job.warning && <p className="phab-monitor-warning"><CircleAlert size={15} />{job.warning}</p>}
              <dl className="phab-monitor-facts">
                <div><dt><MapPin size={13} />Worker location</dt><dd>{job.workerLabel}</dd></div>
                <div><dt><Server size={13} />Worker ID</dt><dd className="phab-monitor-id">{job.workerIdLabel}</dd></div>
                <div data-stale={job.stale}><dt><Activity size={13} />{job.heartbeatTitle}</dt><dd>{job.heartbeatLabel}</dd></div>
                <div><dt><Clock3 size={13} />{job.elapsedTitle}</dt><dd>{job.elapsedLabel}</dd></div>
              </dl>
              <div className="phab-monitor-dates"><span>Queued {job.createdLabel}</span><span>Started {job.startedLabel}</span><span>Last change {job.updatedLabel}</span></div>
              <div className="phab-monitor-log-heading"><h2>Event log</h2><span>Oldest first · latest 80 events</span></div>
              {job.events.length === 0 && <p className="phab-monitor-no-events">{job.emptyLog}</p>}
              <ol className="phab-monitor-events">
                {job.events.map((event) => (
                  <li key={event.id} data-error={event.isError}>
                    <time dateTime={event.at}>{event.timeLabel}</time>
                    <div className="phab-monitor-event-body"><div className="phab-monitor-event-tags"><span>{event.type}</span>{event.tool && <code>{event.tool}</code>}{event.durationLabel && <span>{event.durationLabel}</span>}</div><p>{event.message}</p>{event.detailsText && <details className="phab-monitor-event-details"><summary>Details</summary><pre>{event.detailsText}</pre></details>}</div>
                  </li>
                ))}
              </ol>
              <footer className="phab-monitor-job-footer"><span className="phab-monitor-id">Job {job.id}</span><button {...report.getJobCopyProps(job.id)}><Copy size={12} />Copy job report</button><a href={job.monitorHref}>Link to job <ArrowUpRight size={12} /></a></footer>
            </div>
          </details>
        ))}
      </div>
      <p className="phab-monitor-footnote">This workspace’s latest 30 jobs. Active jobs refresh every few seconds. Research continues when you leave this page.</p>
    </main>
  )
}
