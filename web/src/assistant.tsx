import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { Thread } from '#/components/assistant-ui/elements/thread.aui'
import { TooltipProvider } from '#/components/ui/tooltip'

export function Assistant() {
  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({ api: '/api/chat' }),
  })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <div className="h-dvh">
          <Thread />
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  )
}
