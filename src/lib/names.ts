/**
 * Card-name normalisation used as the comparison key.
 * - case-insensitive
 * - ignores accents / curly apostrophes
 * - for double-faced / split cards, compares on the FRONT face name so that
 *   "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki" and
 *   "Fable of the Mirror-Breaker" match.
 */
export function normaliseName(name: string): string {
  const front = name.split('//')[0] ?? name;
  return front
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Display name: front face only, trimmed. */
export function displayName(name: string): string {
  return name.trim();
}
