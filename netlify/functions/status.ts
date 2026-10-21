import type { Handler } from '@netlify/functions';
import { createKV } from '../lib/kv';

/**
 * Read-only view of the global Moxfield rate-limit schedule, so the web app
 * can warn users when they will have to queue. Never calls Moxfield.
 */
const MIN_GAP_MS = Number(process.env.MOXFIELD_MIN_GAP_MS ?? 1100);

export const handler: Handler = async () => {
  let busyMs = 0;
  try {
    const { value } = await createKV('moxfield-schedule').get<{ nextAt: number }>('schedule');
    busyMs = Math.max(0, (value?.nextAt ?? 0) - Date.now());
  } catch (err) {
    console.warn('status: schedule read failed', (err as Error).message);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      /** Milliseconds until the next free Moxfield slot. */
      busyMs,
      /** Approximate number of requests already queued ahead. */
      queuedCalls: Math.ceil(busyMs / MIN_GAP_MS),
      minGapMs: MIN_GAP_MS,
    }),
  };
};
