import { Mastra } from '@mastra/core'
import { assistantAgent } from './agents/assistant'

export const mastra = new Mastra({
  agents: { assistantAgent },
})
