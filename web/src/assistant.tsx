import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { InfiniteCanvas } from '#/components/canvas/infinite-canvas'
import { CanvasComposer } from '#/components/canvas/canvas-composer'
import { TooltipProvider } from '#/components/ui/tooltip'

function useCanvasAssistant() {
  return useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({ api: '/api/chat' }),
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
