import { schedule } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

/**
 * Scheduled function: deletes cached decks older than the TTL from the
 * `moxfield-decks` Blobs store, so storage doesn't grow forever.
 * Runs hourly on Netlify (it cannot be invoked over HTTP in production).
 */
const DECK_TTL_MS = Number(process.env.MOXFIELD_DECK_TTL_MS ?? 12 * 60 * 60 * 1000);

export const handler = schedule('@hourly', async () => {
  const onNetlify = process.env.NETLIFY === 'true' || !!process.env.NETLIFY_BLOBS_CONTEXT;
  if (!onNetlify) {
    console.log('cleanup-decks: not running on Netlify, nothing to do');
    return { statusCode: 200 };
  }

  const store = getStore({ name: 'moxfield-decks', consistency: 'strong' });
  const cutoff = Date.now() - DECK_TTL_MS;
  let scanned = 0;
  let deleted = 0;

  for await (const page of store.list({ paginate: true })) {
    for (const { key } of page.blobs) {
      scanned++;
      let fetchedAt = Number((await store.getMetadata(key))?.metadata?.fetchedAt);
      if (!Number.isFinite(fetchedAt)) {
        // Entry written before metadata was added: fall back to the body.
        const body = await store.get(key, { type: 'json' }).catch(() => null);
        fetchedAt = Number(body?.fetchedAt);
      }
      if (!Number.isFinite(fetchedAt) || fetchedAt < cutoff) {
        await store.delete(key);
        deleted++;
      }
    }
  }

  console.log(`cleanup-decks: scanned ${scanned}, deleted ${deleted} (older than ${Math.round(DECK_TTL_MS / 3600000)} h)`);
  return { statusCode: 200 };
});
