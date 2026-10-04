import type { MastraModelConfig } from '@mastra/core/llm'

// Routes app inference through the Neon AI Gateway (OpenAI-compatible) when it is
// configured, falling back to the previous direct xAI model so the app keeps
// working with no gateway env set.
//
// Env (set as worker/Fly secrets; also mirrored in AWS SSM under /hyperagent/*):
//   NEON_AI_GATEWAY_BASE_URL  bare branch host, e.g. https://br-…-api.ai.c-6.us-east-2.aws.neon.tech
//   NEON_AI_GATEWAY_TOKEN     nt_live_… credential with scope ai_gateway:invoke
//   NEON_MODEL_ASSISTANT      optional override (default claude-sonnet-5)
//   NEON_MODEL_RESEARCH       optional override (default gpt-5-5)
//
// Env is read lazily (per call) so it resolves from the Cloudflare worker /
// Fly runtime binding rather than at module-eval time.

const FALLBACK_MODEL = 'xai/grok-4.7'

function gateway(): { base: string; token: string } | null {
  const base = process.env.NEON_AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, '')
  const token = process.env.NEON_AI_GATEWAY_TOKEN?.trim()
  return base && token ? { base, token } : null
}

function neonModel(modelId: string, gw: { base: string; token: string }): MastraModelConfig {
  // Mastra resolves this to createOpenAICompatible({ baseURL: url, apiKey }).chatModel(modelId).
  return { id: `neon/${modelId}` as `${string}/${string}`, url: `${gw.base}/v1`, apiKey: gw.token, api: 'chat' }
}

/** Interactive canvas assistant — tool-heavy, latency-sensitive. */
export function assistantModel(): MastraModelConfig {
  const gw = gateway()
  if (!gw) return FALLBACK_MODEL
  return neonModel(process.env.NEON_MODEL_ASSISTANT?.trim() || 'claude-sonnet-5', gw)
}

/** Deep multi-step research worker — quality/reasoning-first. */
export function researchModel(): MastraModelConfig {
  const gw = gateway()
  if (!gw) return FALLBACK_MODEL
  return neonModel(process.env.NEON_MODEL_RESEARCH?.trim() || 'gpt-5-5', gw)
}
