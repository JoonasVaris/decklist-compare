/**
 * Global "one call per second" scheduler shared by every function instance.
 *
 * A single KV entry stores the timestamp of the next free slot. Each caller
 * reads it, claims the slot with a compare-and-set write (so two concurrent
 * callers can never take the same slot), then waits until its slot arrives.
 * Callers that would have to wait longer than `maxWaitMs` are told to retry
 * later instead of holding a function invocation open.
 */
import type { KV } from './kv';

export interface LimiterOptions {
  /** Minimum spacing between upstream calls. */
  minGapMs: number;
  /** Longest a caller is allowed to wait for its slot before being told to retry. */
  maxWaitMs: number;
  /** KV key holding the schedule. */
  key?: string;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Sleep, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface Schedule {
  nextAt: number;
}

export type SlotResult = { ok: true; waitedMs: number; slotAt: number } | { ok: false; retryAfterMs: number };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Claims the next free slot and waits for it. Resolves when the caller may
 * perform exactly one upstream call.
 */
export async function acquireSlot(kv: KV, opts: LimiterOptions): Promise<SlotResult> {
  const key = opts.key ?? 'schedule';
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < 25; attempt++) {
    const { value, etag } = await kv.get<Schedule>(key);
    const t = now();
    const slotAt = Math.max(t, value?.nextAt ?? 0);
    const wait = slotAt - t;
    if (wait > opts.maxWaitMs) return { ok: false, retryAfterMs: wait };

    const claimed = await kv.set<Schedule>(key, { nextAt: slotAt + opts.minGapMs }, { ifMatch: etag });
    if (claimed) {
      if (wait > 0) await sleep(wait);
      return { ok: true, waitedMs: wait, slotAt };
    }
    // Lost the race: back off briefly (jittered) and re-read.
    await sleep(10 + Math.random() * 40);
  }
  return { ok: false, retryAfterMs: opts.minGapMs };
}

/**
 * Pushes the schedule forward after the upstream itself asked us to slow down
 * (HTTP 429), so every instance backs off together.
 */
export async function penalise(kv: KV, ms: number, key = 'schedule'): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, etag } = await kv.get<Schedule>(key);
    const nextAt = Math.max(value?.nextAt ?? 0, Date.now() + ms);
    if (await kv.set<Schedule>(key, { nextAt }, { ifMatch: etag })) return;
  }
}
