/** Distinct, colour-blind-friendly-ish palette for the first few decks. */
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

/**
 * Colour for deck `index`. The first eight come from the hand-picked palette;
 * beyond that, hues are spread around the colour wheel by the golden angle so
 * any number of decks stay distinguishable without repeating.
 */
export function deckColor(index: number): string {
  if (index < DECK_COLORS.length) return DECK_COLORS[index];
  const n = index - DECK_COLORS.length;
  const hue = Math.round((n * 137.508 + 100) % 360); // starts in the lime gap left by the palette
  const light = n % 2 === 0 ? 48 : 62;
  return `hsl(${hue} 70% ${light}%)`;
}
