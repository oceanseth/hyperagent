import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'
import { useMemo } from 'react'
import type { CanvasJob } from '#/lib/canvas'
import { refreshCanvas, receiveCanvasJob, selectedContextIds } from '#/lib/canvas-workspace'
import { InfiniteCanvas } from '#/components/canvas/infinite-canvas'
import { CanvasComposer } from '#/components/canvas/canvas-composer'
import { TooltipProvider } from '#/components/ui/tooltip'

function useCanvasAssistant() {
  const transport = useMemo(() => new AssistantChatTransport({
    api: '/api/chat',
    prepareSendMessagesRequest: async (options) => {
      // Establish the server-owned cookie before sending the first message.
      await refreshCanvas()
      return { body: {
        ...options.body,
        id: options.id,
        messages: options.messages,
        trigger: options.trigger,
        messageId: options.messageId,
        metadata: options.requestMetadata,
        contextStackIds: selectedContextIds(),
      } }
    },
  }), [])
  return useChatRuntime({
    transport,
    onData: (part) => { if (part.type === 'data-canvas-job') receiveCanvasJob(part.data as CanvasJob) },
  })
}

export function Assistant() {
  const runtime = useCanvasAssistant()
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <InfiniteCanvas>
          <CanvasComposer />
        </InfiniteCanvas>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  )
}
