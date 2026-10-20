import type { CardImage } from './types';

/**
 * Scryfall image loader.
 * Uses POST /cards/collection (max 75 identifiers per request) so even large
 * comparisons need only a handful of requests. Results are cached in memory
 * and in localStorage (images URLs only, small) for repeat visits.
 */
const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH = 75;
const REQUEST_GAP_MS = 110; // Scryfall asks for <=10 req/s
const LS_KEY = 'dc.scryfall.v1';

export type Identifier = { id: string } | { name: string };

const memCache = new Map<string, CardImage>();

function cacheKeyFor(ident: Identifier): string {
  return 'id' in ident ? `id:${ident.id}` : `name:${ident.name.toLowerCase()}`;
}

function loadLocal(): Record<string, CardImage> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CardImage>) : {};
  } catch {
    return {};
  }
}
function saveLocal(entries: Record<string, CardImage>) {
  try {
    const existing = loadLocal();
    const merged = { ...existing, ...entries };
    // Keep the cache bounded.
    const keys = Object.keys(merged);
    if (keys.length > 3000) {
      for (const k of keys.slice(0, keys.length - 3000)) delete merged[k];
    }
    localStorage.setItem(LS_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable: ignore */
  }
}

function toCardImage(card: any): CardImage {
  const face = card.image_uris ? card : card.card_faces?.[0];
  const back = card.card_faces?.[1];
  return {
    id: card.id,
    name: card.name,
    image: face?.image_uris?.normal,
    imageSmall: face?.image_uris?.small,
    backImage: back?.image_uris?.normal,
    scryfallUri: card.scryfall_uri,
    typeLine: card.type_line,
    manaCost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost,
    cmc: card.cmc,
    colors: card.colors ?? card.card_faces?.[0]?.colors,
    colorIdentity: card.color_identity,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves many identifiers to card images. Returns a map keyed by the same
 * cache key as `cacheKeyFor`. Missing cards are simply absent from the map.
 * `onProgress` is called after every batch with (done, total).
 */
export async function fetchCardImages(
  idents: Identifier[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Map<string, CardImage>> {
  const result = new Map<string, CardImage>();
  const local = loadLocal();
  const pending: Identifier[] = [];

  for (const ident of idents) {
    const key = cacheKeyFor(ident);
    const hit = memCache.get(key) ?? local[key];
    if (hit) {
      memCache.set(key, hit);
      result.set(key, hit);
    } else {
      pending.push(ident);
    }
  }

  const total = pending.length;
  let done = 0;
  onProgress?.(done, total);
  const newlyFetched: Record<string, CardImage> = {};

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const res = await fetch(COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: batch }),
      signal,
    });
    if (!res.ok) throw new Error(`Scryfall request failed (${res.status})`);
    const body = await res.json();
    const cards: any[] = body.data ?? [];

    // Match returned cards back to identifiers. Scryfall returns data in
    // request order, skipping not_found entries, so map by id and by name.
    const byId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const c of cards) {
      byId.set(c.id, c);
      byName.set(c.name.toLowerCase(), c);
      const front = c.name.split(' // ')[0].toLowerCase();
      if (!byName.has(front)) byName.set(front, c);
    }
    for (const ident of batch) {
      const key = cacheKeyFor(ident);
      const card = 'id' in ident ? byId.get(ident.id) : byName.get(ident.name.toLowerCase());
      if (!card) continue;
      const img = toCardImage(card);
      memCache.set(key, img);
      newlyFetched[key] = img;
      result.set(key, img);
    }

    done += batch.length;
    onProgress?.(done, total);
    if (i + BATCH < pending.length) await sleep(REQUEST_GAP_MS);
  }

  if (Object.keys(newlyFetched).length) saveLocal(newlyFetched);
  return result;
}

export { cacheKeyFor };
