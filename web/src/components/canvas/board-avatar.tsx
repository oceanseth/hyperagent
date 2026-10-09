import { avatarModel, type AvatarKind } from '#/lib/board-avatar'

export function BoardAvatar({ name, color, kind }: { name: string; color: string; kind: AvatarKind }) {
  const model = avatarModel({ name, color, kind })
  return (
    <span
      data-initials={model.initials}
      data-kind={model.kind}
      data-color={model.color}
      data-badge={model.badge === 'bot' ? 'bot' : undefined}
      title={name}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 28,
        height: 28,
        borderRadius: 999,
        border: `2px solid ${model.color}`,
        color: model.color,
        fontSize: 11,
        fontWeight: 650,
      }}
    >
      {model.initials}
    </span>
  )
}
