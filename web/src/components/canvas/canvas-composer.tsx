import {
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react'
import {
  ArrowUpIcon,
  AudioLinesIcon,
  HistoryIcon,
  MessageCircleIcon,
  PhoneIcon,
  PhoneOffIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import { HTreeThinking } from '#/components/brand/htree-thinking'
import { ChatHistoryPanel } from '#/components/canvas/chat-history'
import { MarkdownText } from '#/components/assistant-ui/elements/markdown-text'
import { ToolFallback } from '#/components/assistant-ui/elements/tool-fallback.aui'
import { StripeKeyTool } from '#/components/canvas/stripe-key-tool'
import {
  useCanvasComposer,
  useCanvasMessage,
} from '#/hooks/use-canvas-composer'
import './composer.css'

export function CanvasComposer() {
  const composer = useCanvasComposer()
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  return (
    <ThreadPrimitive.Root className="canvas-chat">
      {isHistoryOpen && <ChatHistoryPanel onClose={() => setIsHistoryOpen(false)} />}
      {composer.isPanelOpen && (
        <section className="canvas-conversation" {...composer.panelProps}>
          <div className="canvas-conversation-header">
            <MessageCircleIcon aria-hidden="true" size={15} />
            <span>Conversation</span>
            {composer.isRunning && (
              <HTreeThinking className="canvas-chat-spinner" size={15} />
            )}
            <button
              type="button"
              className="canvas-conversation-close"
              {...composer.closeButtonProps}
            >
              <XIcon aria-hidden="true" size={16} />
            </button>
          </div>
          <ThreadPrimitive.Viewport className="canvas-conversation-viewport">
            <ThreadPrimitive.Messages>
              {() => <CanvasMessage />}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
        </section>
      )}

      {composer.showReopenButton && (
        <button
          type="button"
          className="canvas-conversation-reopen"
          {...composer.reopenButtonProps}
        >
          <MessageCircleIcon aria-hidden="true" size={14} />
          Conversation
          {composer.isRunning && (
            <HTreeThinking className="canvas-chat-spinner" size={15} />
          )}
        </button>
      )}

      {composer.voice.error && (
        <div className="canvas-voice-error" role="alert">
          {composer.voice.error}
        </div>
      )}
      {composer.voiceStatus && (
        <div className="canvas-voice-status" role="status">
          <span className="canvas-voice-dot" />
          {composer.voiceStatus}
        </div>
      )}
      {composer.voiceCaption && (
        <div className="canvas-voice-caption" data-role={composer.voiceCaption.role}>
          {composer.voiceCaption.text.trim()}
        </div>
      )}

      <ComposerPrimitive.Root
        className="canvas-composer"
        {...composer.formProps}
      >
        <ComposerPrimitive.Input
          className="canvas-composer-input"
          rows={1}
          maxRows={5}
          enterKeyHint="send"
          cancelOnEscape={false}
          {...composer.inputProps}
        />
        <div className="canvas-composer-actions">
          <button
            type="button"
            className="canvas-composer-voice"
            data-active={isHistoryOpen}
            onClick={() => setIsHistoryOpen((open) => !open)}
            aria-label="Chat history"
            aria-pressed={isHistoryOpen}
            title="Chat history"
          >
            <HistoryIcon aria-hidden="true" size={17} />
          </button>
          <button
            className="canvas-composer-voice"
            data-active={composer.voice.isActive}
            {...composer.voiceButtonProps}
          >
            {composer.voice.isActive ? (
              <PhoneOffIcon aria-hidden="true" size={17} />
            ) : (
              <PhoneIcon aria-hidden="true" size={17} />
            )}
          </button>
          {composer.canCancel ? (
            <ComposerPrimitive.Cancel
              className="canvas-composer-send"
              {...composer.cancelButtonProps}
            >
              <SquareIcon aria-hidden="true" size={13} fill="currentColor" />
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              className="canvas-composer-send"
              {...composer.sendButtonProps}
            >
              <ArrowUpIcon aria-hidden="true" size={20} strokeWidth={2.3} />
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  )
}

function CanvasMessage() {
  const message = useCanvasMessage()

  return (
    <MessagePrimitive.Root className="canvas-message" {...message.rootProps}>
      <div className="canvas-message-label">
        {message.label}
        {message.isVoice && <AudioLinesIcon aria-hidden="true" size={12} />}
      </div>
      <div className="canvas-message-content">
        <MessagePrimitive.Parts
          components={{ Text: MarkdownText, tools: { by_name: { request_stripe_key: StripeKeyTool }, Fallback: ToolFallback } }}
        />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="canvas-message-error">
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  )
}
