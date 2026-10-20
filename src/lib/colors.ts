/** Distinct, colour-blind-friendly-ish palette for deck badges. */
export const DECK_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

export function deckColor(index: number): string {
  return DECK_COLORS[index % DECK_COLORS.length];
}
