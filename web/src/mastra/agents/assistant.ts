import { Agent } from '@mastra/core/agent'

export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'xai/grok-4.7',
})
