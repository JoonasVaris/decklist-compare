import { normaliseName } from './names';
import type { Board, ComparedCard, ComparisonResult, Deck } from './types';

export interface CompareOptions {
  /** Which boards count towards a deck's card pool. */
  boards: Board[];
}

/** Only the mainboard is compared; the app targets singleton/highlander formats. */
export const DEFAULT_BOARDS: Board[] = ['mainboard'];

/**
 * Builds the three-way comparison:
 *  - common: in every deck
 *  - partial: in at least two decks but not all (only meaningful for 3+ decks)
 *  - unique: in exactly one deck (per deck)
 * Cards are matched by normalised name (see names.ts), quantities are kept per deck.
 */
export function compareDecks(decks: Deck[], opts: CompareOptions = { boards: DEFAULT_BOARDS }): ComparisonResult {
  const boardSet = new Set(opts.boards);
  const all: Record<string, ComparedCard> = {};

  for (const deck of decks) {
    for (const card of deck.cards) {
      if (!boardSet.has(card.board)) continue;
      const key = normaliseName(card.name);
      let row = all[key];
      if (!row) {
        row = { key, name: card.name, quantities: {}, deckIds: [], scryfallId: card.scryfallId };
        all[key] = row;
      }
      if (!row.scryfallId && card.scryfallId) row.scryfallId = card.scryfallId;
      if (!(deck.id in row.quantities)) row.deckIds.push(deck.id);
      row.quantities[deck.id] = (row.quantities[deck.id] ?? 0) + card.quantity;
    }
  }

  const common: ComparedCard[] = [];
  const partial: ComparedCard[] = [];
  const unique: Record<string, ComparedCard[]> = Object.fromEntries(decks.map((d) => [d.id, []]));
  const n = decks.length;

  for (const row of Object.values(all)) {
    const count = row.deckIds.length;
    if (count === n && n > 0) common.push(row);
    else if (count === 1) unique[row.deckIds[0]].push(row);
    else if (count >= 2) partial.push(row);
  }

  const byName = (a: ComparedCard, b: ComparedCard) => a.name.localeCompare(b.name);
  common.sort(byName);
  // Partial: most-shared first, then name.
  partial.sort((a, b) => b.deckIds.length - a.deckIds.length || byName(a, b));
  for (const list of Object.values(unique)) list.sort(byName);

  return { decks, common, partial, unique, all };
}

/** Jaccard-style overlap between two decks (0..1) over the compared card names. */
export function overlapMatrix(result: ComparisonResult): number[][] {
  const { decks, all } = result;
  const sets = decks.map((d) => new Set(Object.values(all).filter((c) => d.id in c.quantities).map((c) => c.key)));
  return sets.map((a) =>
    sets.map((b) => {
      let inter = 0;
      for (const k of a) if (b.has(k)) inter++;
      const union = a.size + b.size - inter;
      return union === 0 ? 0 : inter / union;
    }),
  );
}
