import { PHAB_COLOR } from './board-palette'

export type AvatarKind = 'human' | 'agent' | 'phab'

export function avatarModel(input: { name: string; color: string; kind: AvatarKind }) {
  const initials = input.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('')
  if (input.kind === 'agent') return { initials, color: input.color, kind: input.kind, badge: 'bot' as const }
  if (input.kind === 'phab') return { initials, color: PHAB_COLOR, kind: input.kind, badge: null }
  return { initials, color: input.color, kind: input.kind, badge: null }
}
