import type { Handler } from '@netlify/functions';
import { createKV } from '../lib/kv';
import { acquireSlot, penalise } from '../lib/limiter';

/**
 * Proxy for the Moxfield deck API.
 *
 * Browsers cannot call api2.moxfield.com directly (no CORS, Cloudflare bot
 * protection), so this function fetches the deck server-side and returns a
 * trimmed JSON payload.
 *
 * Moxfield grants approved tools a private User-Agent (MOXFIELD_USER_AGENT in
 * the Netlify environment, never in the repo or the browser) on the condition
 * of at most one API call per second. That limit is enforced globally across
 * all function instances with a Blobs-backed scheduler (see ../lib/limiter.ts),
 * and most calls are avoided altogether by caching decks in Blobs and on the CDN.
 */
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const UPSTREAM = 'https://api2.moxfield.com/v3/decks/all/';

/** Spacing between upstream calls. 1100 ms gives a safety margin over "1 per second". */
const MIN_GAP_MS = Number(process.env.MOXFIELD_MIN_GAP_MS ?? 1100);
/**
 * Longest a request waits for its slot before asking the browser to retry (429).
 * Netlify stops synchronous functions after 10 s, so the wait is additionally
 * capped by the remaining execution time; a long queue yields a clean
 * 429 + Retry-After rather than a killed function. The browser retries transparently.
 */
const MAX_WAIT_MS = Number(process.env.MOXFIELD_MAX_WAIT_MS ?? 8000);
/** Time reserved for the Moxfield call and cache write after the wait. */
const RESERVE_MS = 2500;
/** How long a fetched deck is reused from the Blobs cache (entries older than this are also deleted hourly). */
const DECK_TTL_MS = Number(process.env.MOXFIELD_DECK_TTL_MS ?? 12 * 60 * 60 * 1000);

type Board = 'mainboard' | 'commanders' | 'companions' | 'sideboard' | 'maybeboard';
const BOARDS: Board[] = ['commanders', 'companions', 'mainboard', 'sideboard', 'maybeboard'];

function json(statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Successful decks may be cached by the CDN; errors must never be.
      'Cache-Control': statusCode === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

/** Keep only the fields the client needs so responses (and cache entries) stay small. */
function trimDeck(raw: any) {
  const boards: Record<string, { count: number; cards: Record<string, unknown> }> = {};
  for (const board of BOARDS) {
    const b = raw?.boards?.[board];
    if (!b?.cards) continue;
    const cards: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries<any>(b.cards)) {
      if (!entry?.card?.name) continue;
      cards[key] = {
        quantity: entry.quantity ?? 1,
        card: {
          name: entry.card.name,
          scryfall_id: entry.card.scryfall_id,
          set: entry.card.set,
          cn: entry.card.cn,
        },
      };
    }
    boards[board] = { count: b.count ?? Object.keys(cards).length, cards };
  }
  return {
    publicId: raw.publicId,
    name: raw.name,
    format: raw.format,
    createdByUser: raw.createdByUser
      ? { userName: raw.createdByUser.userName, displayName: raw.createdByUser.displayName }
      : undefined,
    boards,
  };
}

interface CachedDeck {
  fetchedAt: number;
  deck: ReturnType<typeof trimDeck>;
}

export const handler: Handler = async (event, context) => {
  const id = event.queryStringParameters?.id ?? '';
  if (!ID_RE.test(id)) {
    return json(400, { error: 'Invalid or missing deck id.' });
  }
  const debug = event.queryStringParameters?.debug === '1';
  const decks = createKV('moxfield-decks');
  const schedule = createKV('moxfield-schedule');

  // 1. Serve from the shared deck cache when fresh.
  try {
    const cached = await decks.get<CachedDeck>(id);
    if (cached.value && Date.now() - cached.value.fetchedAt < DECK_TTL_MS) {
      return json(200, cached.value.deck, { 'X-Deck-Source': 'cache' });
    }
  } catch (err) {
    console.warn('deck cache read failed', (err as Error).message);
  }

  // 2. Wait for our global 1-call-per-second slot, within what the runtime allows.
  const remaining =
    typeof context?.getRemainingTimeInMillis === 'function' ? context.getRemainingTimeInMillis() : Number.POSITIVE_INFINITY;
  const maxWaitMs = Math.max(0, Math.min(MAX_WAIT_MS, remaining - RESERVE_MS));
  const slot = await acquireSlot(schedule, { minGapMs: MIN_GAP_MS, maxWaitMs });
  if (!slot.ok) {
    const seconds = Math.ceil(slot.retryAfterMs / 1000);
    return json(
      429,
      { error: `Busy: waiting for Moxfield rate limit. Retry in ${seconds}s.`, retryAfterMs: slot.retryAfterMs },
      { 'Retry-After': String(seconds) },
    );
  }

  // 3. Exactly one upstream call.
  const userAgent = process.env.MOXFIELD_USER_AGENT || 'decklist-compare/0.1';
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + encodeURIComponent(id), {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
  } catch (err) {
    return json(502, { error: `Could not reach Moxfield: ${(err as Error).message}` });
  }
  const slotHeaders = { 'X-Deck-Source': 'moxfield', 'X-Slot-At': String(slot.slotAt), 'X-Slot-Waited-Ms': String(slot.waitedMs) };

  if (upstream.status === 429) {
    // Moxfield asked us to slow down: push every instance's schedule back.
    const retryAfter = Number(upstream.headers.get('retry-after') ?? 5) * 1000;
    await penalise(schedule, retryAfter);
    return json(429, { error: 'Moxfield is rate limiting us. Please retry shortly.' }, { 'Retry-After': String(Math.ceil(retryAfter / 1000)) });
  }
  if (upstream.status === 404) {
    return json(404, { error: 'Deck not found. Is it public?' }, slotHeaders);
  }
  if (upstream.status === 403 || upstream.status === 401) {
    // Log enough to tell a Cloudflare block from a private deck (visible in Netlify function logs).
    const body = await upstream.text().catch(() => '');
    const info = {
      upstreamStatus: upstream.status,
      server: upstream.headers.get('server'),
      cfMitigated: upstream.headers.get('cf-mitigated'),
      cfRay: upstream.headers.get('cf-ray'),
      cfErrorCode: body.match(/error code:? ?(\d+)/i)?.[1] ?? null,
      contentType: upstream.headers.get('content-type'),
    };
    console.warn('moxfield upstream refused', JSON.stringify(info));
    return json(
      403,
      {
        error:
          'Moxfield refused the request (403). The deck may be private, or this app’s User-Agent is not approved by Moxfield. You can paste the decklist text instead.',
        ...(debug ? { debug: info } : {}),
      },
      slotHeaders,
    );
  }
  if (!upstream.ok) {
    return json(502, { error: `Moxfield responded with ${upstream.status}.` }, slotHeaders);
  }
  if (!(upstream.headers.get('content-type') ?? '').includes('application/json')) {
    return json(502, { error: 'Moxfield returned a non-JSON response (likely a bot-protection page).' }, slotHeaders);
  }

  let deck: ReturnType<typeof trimDeck>;
  try {
    deck = trimDeck(await upstream.json());
  } catch (err) {
    return json(502, { error: `Could not parse Moxfield response: ${(err as Error).message}` }, slotHeaders);
  }

  // 4. Remember it for everyone. fetchedAt also goes into blob metadata so the
  //    scheduled cleanup (cleanup-decks.ts) can age entries without reading them.
  try {
    const fetchedAt = Date.now();
    await decks.set<CachedDeck>(id, { fetchedAt, deck }, undefined, { fetchedAt: String(fetchedAt) });
  } catch (err) {
    console.warn('deck cache write failed', (err as Error).message);
  }
  return json(200, deck, slotHeaders);
};
