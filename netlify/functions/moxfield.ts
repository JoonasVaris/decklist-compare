import type { Handler } from '@netlify/functions';

/**
 * Proxy for the Moxfield deck API.
 *
 * Browsers cannot call api2.moxfield.com directly (no CORS, Cloudflare bot
 * protection), so this function fetches the deck server-side and returns a
 * trimmed JSON payload.
 *
 * Moxfield asks third-party tools to identify themselves with a User-Agent
 * that they have approved (contact support@moxfield.com). Set it in the
 * Netlify environment as MOXFIELD_USER_AGENT. Without an approved UA the
 * upstream may answer 403, in which case the UI offers a paste fallback.
 */
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const UPSTREAM = 'https://api2.moxfield.com/v3/decks/all/';

const CACHE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // Decks change rarely; let the CDN cache for 5 minutes.
  'Cache-Control': 'public, max-age=60, s-maxage=300',
};

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CACHE_HEADERS, body: JSON.stringify(body) };
}

type Board = 'mainboard' | 'commanders' | 'companions' | 'sideboard' | 'maybeboard';
const BOARDS: Board[] = ['commanders', 'companions', 'mainboard', 'sideboard', 'maybeboard'];

/** Keep only the fields the client needs so responses stay small. */
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

export const handler: Handler = async (event) => {
  const id = event.queryStringParameters?.id ?? '';
  if (!ID_RE.test(id)) {
    return json(400, { error: 'Invalid or missing deck id.' });
  }

  const userAgent =
    process.env.MOXFIELD_USER_AGENT ||
    'decklist-compare/0.1';

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + encodeURIComponent(id), {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
  } catch (err) {
    return json(502, { error: `Could not reach Moxfield: ${(err as Error).message}` });
  }

  if (upstream.status === 404) {
    return json(404, { error: 'Deck not found. Is it public?' });
  }
  if (upstream.status === 403 || upstream.status === 401) {
    return json(403, {
      error:
        'Moxfield refused the request (403). The deck may be private, or this app’s User-Agent is not approved by Moxfield. You can paste the decklist text instead.',
    });
  }
  if (!upstream.ok) {
    return json(502, { error: `Moxfield responded with ${upstream.status}.` });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return json(502, { error: 'Moxfield returned a non-JSON response (likely a bot-protection page).' });
  }

  try {
    const raw = await upstream.json();
    return json(200, trimDeck(raw));
  } catch (err) {
    return json(502, { error: `Could not parse Moxfield response: ${(err as Error).message}` });
  }
};
