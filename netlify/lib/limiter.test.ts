import { describe, expect, it } from 'vitest';
import { acquireSlot } from './limiter';
import { FileKV, type KV, type KVEntry } from './kv';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** In-memory KV with real compare-and-set, used to simulate many function instances. */
class MemoryKV implements KV {
  private data = new Map<string, { raw: string; etag: string }>();
  private version = 0;
  async get<T>(key: string): Promise<KVEntry<T>> {
    const e = this.data.get(key);
    // Yield to the event loop so interleavings resemble network calls.
    await new Promise((r) => setTimeout(r, 0));
    return e ? { value: JSON.parse(e.raw) as T, etag: e.etag } : { value: null, etag: null };
  }
  async set<T>(key: string, value: T, cond?: { ifMatch: string | null }): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 0));
    const current = this.data.get(key)?.etag ?? null;
    if (cond !== undefined && current !== cond.ifMatch) return false;
    this.data.set(key, { raw: JSON.stringify(value), etag: String(++this.version) });
    return true;
  }
}

function run(kv: KV, callers: number, opts: { minGapMs: number; maxWaitMs: number }) {
  // Frozen clock + no-op sleep: every caller arrives "at the same instant", which is the
  // worst case for the scheduler, and the test finishes instantly.
  const clock = 1_000_000;
  const sleep = async () => {};
  return Promise.all(Array.from({ length: callers }, () => acquireSlot(kv, { ...opts, now: () => clock, sleep })));
}

describe('acquireSlot', () => {
  it('gives concurrent callers distinct slots at least minGapMs apart', async () => {
    const results = await run(new MemoryKV(), 8, { minGapMs: 1000, maxWaitMs: 60_000 });
    const slots = results
      .map((r) => (r.ok ? r.slotAt : NaN))
      .filter((s) => !Number.isNaN(s))
      .sort((a, b) => a - b);
    expect(slots).toHaveLength(8);
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it('tells callers to retry when the queue is longer than maxWaitMs', async () => {
    const results = await run(new MemoryKV(), 10, { minGapMs: 1000, maxWaitMs: 3000 });
    const ok = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok) as Array<{ ok: false; retryAfterMs: number }>;
    // Slots at 0,1,2,3 s fit inside a 3 s wait; the rest must retry.
    expect(ok).toHaveLength(4);
    expect(rejected).toHaveLength(6);
    for (const r of rejected) expect(r.retryAfterMs).toBeGreaterThan(3000);
  });

  it('works with the file-backed KV used in local dev', async () => {
    const kv = new FileKV('test', mkdtempSync(join(tmpdir(), 'kv-test-')));
    const results = await run(kv, 5, { minGapMs: 1000, maxWaitMs: 60_000 });
    const slots = results.map((r) => (r.ok ? r.slotAt : NaN)).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBeGreaterThanOrEqual(1000);
  });
});
