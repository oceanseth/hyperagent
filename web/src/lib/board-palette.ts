export const PALETTE = [
  '#8AA2FF',
  '#F2A3C7',
  '#F0C36A',
  '#7DDBB5',
  '#FF9B7A',
  '#C9A6FF',
  '#7AD7F0',
  '#E8E29A',
  '#F09AA8',
  '#B6E38A',
] as const

export const PHAB_COLOR = '#F7F4EF'

/** First palette color not already used on the board. Wraps to the first only when all ten are taken. */
export function assignColor(used: readonly string[]) {
  const taken = new Set(used)
  return PALETTE.find((color) => !taken.has(color)) ?? PALETTE[0]
}
