import type { MastraModelConfig } from '@mastra/core/llm'

// All app inference goes through the Neon AI Gateway (OpenAI-compatible).
// There is no other model path.
//
// Env (set as Lambda / Fly secrets; mirrored in AWS SSM under /hyperagent/*):
//   NEON_AI_GATEWAY_BASE_URL  bare branch host, e.g. https://br-…-api.ai.c-6.us-east-2.aws.neon.tech
//   NEON_AI_GATEWAY_TOKEN     nt_live_… credential with scope ai_gateway:invoke
//   NEON_MODEL_ASSISTANT      optional override (default claude-sonnet-5)
//   NEON_MODEL_RESEARCH       optional override (default gpt-5-5)
//   NEON_MODEL_BROWSER        optional override for the browser agent (default: assistant model)
//
// Env is read lazily (per call) so it resolves from the runtime binding rather
// than at module-eval time.

function gateway(): { base: string; token: string } {
  const base = process.env.NEON_AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, '')
  const token = process.env.NEON_AI_GATEWAY_TOKEN?.trim()
  if (!base || !token) {
    throw new Error('Set NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN; the app has no other inference path.')
  }
  return { base, token }
}

function neonModel(modelId: string): MastraModelConfig {
  const gw = gateway()
  // Mastra resolves this to createOpenAICompatible({ baseURL: url, apiKey }).chatModel(modelId).
  return { id: `neon/${modelId}` as `${string}/${string}`, url: `${gw.base}/v1`, apiKey: gw.token, api: 'chat' }
}

/** Interactive canvas assistant — tool-heavy, latency-sensitive. */
export function assistantModel(): MastraModelConfig {
  return neonModel(process.env.NEON_MODEL_ASSISTANT?.trim() || 'claude-sonnet-5')
}

/** Deep multi-step research worker — quality/reasoning-first. */
export function researchModel(): MastraModelConfig {
  return neonModel(process.env.NEON_MODEL_RESEARCH?.trim() || 'gpt-5-5')
}

/** Browser agent on the Fly worker — drives a live KERNEL session with tools. */
export function browserModel(): MastraModelConfig {
  return neonModel(process.env.NEON_MODEL_BROWSER?.trim() || process.env.NEON_MODEL_ASSISTANT?.trim() || 'claude-sonnet-5')
}
