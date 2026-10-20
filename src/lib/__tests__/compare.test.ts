import { describe, expect, it } from 'vitest';
import { compareDecks } from '../compare';
import { parseMoxfieldId, parseTextDecklist } from '../moxfield';
import { normaliseName } from '../names';

const deck = (id: string, text: string) => parseTextDecklist(text, id, id);

describe('parseMoxfieldId', () => {
  it('extracts ids from URLs and bare ids', () => {
    expect(parseMoxfieldId('https://www.moxfield.com/decks/ZSNz2NB9ZU-gOSeIDgkMzw')).toBe('ZSNz2NB9ZU-gOSeIDgkMzw');
    expect(parseMoxfieldId('moxfield.com/decks/abc_DEF-123?x=1')).toBe('abc_DEF-123');
    expect(parseMoxfieldId('ZSNz2NB9ZU-gOSeIDgkMzw')).toBe('ZSNz2NB9ZU-gOSeIDgkMzw');
    expect(parseMoxfieldId('https://archidekt.com/decks/123')).toBeNull();
    expect(parseMoxfieldId('')).toBeNull();
  });
});

describe('parseTextDecklist', () => {
  it('parses quantities, set codes, boards and MTGO-style sideboard', () => {
    const d = parseTextDecklist(
      `1 Sol Ring (C21) 263
4x Lightning Bolt
2 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) 141 *F*

Sideboard
2 Rest in Peace
SB: 1 Pithing Needle
// Maybeboard
1 Opt`,
      'x',
    );
    expect(d.cards).toEqual([
      expect.objectContaining({ name: 'Sol Ring', quantity: 1, board: 'mainboard', set: 'c21', collectorNumber: '263' }),
      expect.objectContaining({ name: 'Lightning Bolt', quantity: 4, board: 'mainboard' }),
      expect.objectContaining({ name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', quantity: 2, set: 'neo' }),
      expect.objectContaining({ name: 'Rest in Peace', quantity: 2, board: 'sideboard' }),
      expect.objectContaining({ name: 'Pithing Needle', quantity: 1, board: 'sideboard' }),
      expect.objectContaining({ name: 'Opt', quantity: 1, board: 'maybeboard' }),
    ]);
  });
});

describe('normaliseName', () => {
  it('matches front faces, case and accents', () => {
    expect(normaliseName('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')).toBe(normaliseName('fable of the mirror-breaker'));
    expect(normaliseName('Lim-Dûl’s Vault')).toBe("lim-dul's vault");
  });
});

describe('compareDecks', () => {
  const a = deck('a', '1 Sol Ring\n1 Arcane Signet\n1 Counterspell\n1 Island');
  const b = deck('b', '1 Sol Ring\n1 Arcane Signet\n1 Swamp\n1 Counterspell');
  const c = deck('c', '1 Sol Ring\n1 Swamp\n1 Mountain\n2 Arcane Signet');

  it('splits into common / partial / unique for three decks', () => {
    const r = compareDecks([a, b, c]);
    expect(r.common.map((x) => x.name)).toEqual(['Arcane Signet', 'Sol Ring']);
    expect(r.partial.map((x) => x.name)).toEqual(['Counterspell', 'Swamp']);
    expect(r.unique.a.map((x) => x.name)).toEqual(['Island']);
    expect(r.unique.b).toEqual([]);
    expect(r.unique.c.map((x) => x.name)).toEqual(['Mountain']);
    expect(r.all[normaliseName('Arcane Signet')].quantities).toEqual({ a: 1, b: 1, c: 2 });
  });

  it('has no partial category for two decks', () => {
    const r = compareDecks([a, b]);
    expect(r.partial).toEqual([]);
    expect(r.common.map((x) => x.name)).toEqual(['Arcane Signet', 'Counterspell', 'Sol Ring']);
    expect(r.unique.a.map((x) => x.name)).toEqual(['Island']);
    expect(r.unique.b.map((x) => x.name)).toEqual(['Swamp']);
  });

  it('respects the boards option', () => {
    const d1 = deck('d1', '1 Sol Ring\nSideboard\n1 Opt');
    const d2 = deck('d2', '1 Opt');
    expect(compareDecks([d1, d2]).common).toEqual([]);
    expect(compareDecks([d1, d2], { boards: ['mainboard', 'sideboard'] }).common.map((x) => x.name)).toEqual(['Opt']);
  });
});
