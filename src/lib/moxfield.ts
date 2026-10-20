import type { Board, Deck, DeckCard } from './types';

const MOXFIELD_DECK_RE = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i;

/** Extracts the Moxfield public deck id from a URL or a bare id. Returns null if not recognised. */
export function parseMoxfieldId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(MOXFIELD_DECK_RE);
  if (m) return m[1];
  // Bare id (Moxfield ids are 22 url-safe base64 chars, but don't be too strict)
  if (/^[A-Za-z0-9_-]{10,40}$/.test(trimmed)) return trimmed;
  return null;
}

export function moxfieldDeckUrl(publicId: string): string {
  return `https://www.moxfield.com/decks/${publicId}`;
}

/* ---------- Raw Moxfield API shapes (only what we use) ---------- */

interface MoxCardInfo {
  name: string;
  scryfall_id?: string;
  set?: string;
  cn?: string;
}
interface MoxBoardEntry {
  quantity: number;
  card: MoxCardInfo;
}
interface MoxBoard {
  count?: number;
  cards: Record<string, MoxBoardEntry>;
}
export interface MoxDeckV3 {
  publicId: string;
  name: string;
  format?: string;
  createdByUser?: { userName?: string; displayName?: string };
  boards: Partial<Record<Board, MoxBoard>>;
}

const BOARD_ORDER: Board[] = ['commanders', 'companions', 'mainboard', 'sideboard', 'maybeboard'];

/** Converts a Moxfield v3 deck payload into our Deck shape. */
export function deckFromMoxfield(raw: MoxDeckV3, id: string): Deck {
  const cards: DeckCard[] = [];
  for (const board of BOARD_ORDER) {
    const b = raw.boards?.[board];
    if (!b?.cards) continue;
    for (const entry of Object.values(b.cards)) {
      if (!entry?.card?.name) continue;
      cards.push({
        name: entry.card.name,
        quantity: entry.quantity ?? 1,
        board,
        scryfallId: entry.card.scryfall_id,
        set: entry.card.set,
        collectorNumber: entry.card.cn,
      });
    }
  }
  return {
    id,
    name: raw.name || raw.publicId,
    author: raw.createdByUser?.displayName || raw.createdByUser?.userName,
    format: raw.format,
    url: moxfieldDeckUrl(raw.publicId),
    publicId: raw.publicId,
    cards,
    source: 'moxfield',
  };
}

/* ---------- Text decklist fallback ---------- */

const SECTION_HEADERS: Record<string, Board> = {
  commander: 'commanders',
  commanders: 'commanders',
  companion: 'companions',
  companions: 'companions',
  deck: 'mainboard',
  main: 'mainboard',
  mainboard: 'mainboard',
  'main deck': 'mainboard',
  sideboard: 'sideboard',
  side: 'sideboard',
  maybeboard: 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
};

/**
 * Parses a plain-text decklist (Moxfield / Arena / MTGO export style):
 *   1 Sol Ring (C21) 263
 *   4x Lightning Bolt
 *   // Sideboard   or   Sideboard:   headers switch boards
 * Lines starting with "SB:" go to the sideboard (MTGO style).
 */
export function parseTextDecklist(text: string, id: string, name = 'Pasted deck'): Deck {
  const cards: DeckCard[] = [];
  let board: Board = 'mainboard';
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(/^(?:\/\/|#)?\s*([A-Za-z ]+?)\s*:?\s*(?:\(\d+\))?$/);
    if (headerMatch) {
      const key = headerMatch[1].trim().toLowerCase();
      if (key in SECTION_HEADERS) {
        board = SECTION_HEADERS[key];
        continue;
      }
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;

    let lineBoard = board;
    if (/^SB:\s*/i.test(line)) {
      lineBoard = 'sideboard';
      line = line.replace(/^SB:\s*/i, '');
    }

    const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    let quantity = 1;
    let rest = line;
    if (m) {
      quantity = parseInt(m[1], 10);
      rest = m[2];
    }

    // Strip trailing "(SET) 123", "*F*", "[tags]", "#comments"
    let set: string | undefined;
    let cn: string | undefined;
    const setMatch = rest.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9★-]+)?/);
    if (setMatch) {
      rest = setMatch[1];
      set = setMatch[2].toLowerCase();
      cn = setMatch[3];
    }
    rest = rest.replace(/\s*\*F\*\s*$/i, '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s*#.*$/, '').trim();
    if (!rest) continue;

    cards.push({ name: rest, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1, board: lineBoard, set, collectorNumber: cn });
  }
  return { id, name, cards, source: 'text' };
}

/* ---------- Loading via the Netlify function ---------- */

export class MoxfieldLoadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'MoxfieldLoadError';
  }
}

export async function loadMoxfieldDeck(publicId: string, id: string, signal?: AbortSignal): Promise<Deck> {
  const res = await fetch(`/api/moxfield?id=${encodeURIComponent(publicId)}`, { signal });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new MoxfieldLoadError(detail || `Moxfield request failed (${res.status})`, res.status);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new MoxfieldLoadError('The deck API is not reachable from this page (non-JSON response). Try again later or paste the list.');
  }
  const raw = (await res.json()) as MoxDeckV3;
  return deckFromMoxfield(raw, id);
}
