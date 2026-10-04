export async function dispatchResearch(workspaceId: string, jobId: string) {
  const url = process.env.JOBS_URL
  const secret = process.env.JOBS_SECRET
  if (!url || !secret) throw new Error('Background research is not configured.')
  const response = await fetch(new URL('/enqueue', url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, jobId }),
    signal: AbortSignal.timeout(2000),
  })
  if (!response.ok) throw new Error('Could not start the research job. Please try again.')
}
