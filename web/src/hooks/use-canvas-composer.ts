import { useCallback, useId, useState, type FormEvent } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { useVoice } from '#/hooks/use-voice'

export function useCanvasComposer() {
  const panelId = useId()
  const [isDismissed, setIsDismissed] = useState(false)
  const hasMessages = useAuiState((state) => state.thread.messages.length > 0)
  const isRunning = useAuiState((state) => state.thread.isRunning)
  const canCancel = useAuiState((state) => state.composer.canCancel)

  const openConversation = useCallback(() => setIsDismissed(false), [])
  const closeConversation = useCallback(() => setIsDismissed(true), [])
  const voice = useVoice()
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (voice.isActive) {
        event.preventDefault()
        return
      }
      openConversation()
    },
    [openConversation, voice.isActive],
  )

  const isPanelOpen = hasMessages && !isDismissed
  const voiceStatus = {
    idle: '',
    connecting: 'Calling Phab…',
    listening: 'On call · listening',
    speaking: 'On call · Phab is speaking',
    error: '',
  }[voice.status]

  return {
    isPanelOpen,
    showReopenButton: hasMessages && isDismissed,
    isRunning,
    canCancel,
    voice,
    voiceStatus,
    voiceCaption: voice.isActive ? voice.captions.at(-1) : undefined,
    panelProps: { id: panelId, 'aria-label': 'Conversation' },
    formProps: { onSubmit, 'aria-label': 'Message assistant' },
    inputProps: {
      'aria-label': 'Message',
      placeholder: 'Start a conversation',
      disabled: voice.isActive,
    },
    voiceButtonProps: {
      ...voice.buttonProps,
      disabled: isRunning && !voice.isActive,
    },
    closeButtonProps: {
      onClick: closeConversation,
      'aria-label': 'Hide conversation',
      title: 'Hide conversation',
    },
    reopenButtonProps: {
      onClick: openConversation,
      'aria-controls': panelId,
      'aria-expanded': isPanelOpen,
    },
    sendButtonProps: {
      onClick: openConversation,
      disabled: voice.isActive,
      'aria-label': 'Send message',
      title: 'Send message',
    },
    cancelButtonProps: {
      'aria-label': 'Stop response',
      title: 'Stop response',
    },
  }
}

export function useCanvasMessage() {
  const role = useAuiState((state) => state.message.role)
  const isVoice = useAuiState(
    (state) => state.message.metadata.modality === 'voice',
  )

  return {
    rootProps: { 'data-role': role },
    label: role === 'user' ? 'You' : 'Assistant',
    isVoice,
  }
}
