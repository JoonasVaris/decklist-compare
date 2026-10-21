/**
 * Tiny key-value abstraction with compare-and-set semantics.
 *
 * - On Netlify, backed by Netlify Blobs (strong consistency + conditional writes),
 *   which is shared by every function instance → a truly global state.
 * - Locally (plain `vite` dev), backed by files in the OS temp dir, with an
 *   atomic mkdir lock so concurrent requests in dev behave like production.
 */
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface KVEntry<T> {
  value: T | null;
  /** Opaque version tag; null when the key does not exist. */
  etag: string | null;
}

export interface KV {
  get<T>(key: string): Promise<KVEntry<T>>;
  /**
   * Writes `value`. With `ifMatch`, succeeds only if the current etag equals it;
   * with `ifMatch: null`, succeeds only if the key does not exist yet.
   * Returns false when the condition failed (someone else wrote first).
   * `metadata` (small string map) is stored alongside the value where the backend supports it.
   */
  set<T>(key: string, value: T, cond?: { ifMatch: string | null }, metadata?: Record<string, string>): Promise<boolean>;
}

/* ---------------- Netlify Blobs ---------------- */

export class BlobsKV implements KV {
  private store;
  constructor(name: string) {
    this.store = getStore({ name, consistency: 'strong' });
  }
  async get<T>(key: string): Promise<KVEntry<T>> {
    const res = await this.store.getWithMetadata(key, { type: 'json' });
    if (!res) return { value: null, etag: null };
    return { value: res.data as T, etag: res.etag ?? null };
  }
  async set<T>(key: string, value: T, cond?: { ifMatch: string | null }, metadata?: Record<string, string>): Promise<boolean> {
    const conditions = cond === undefined ? {} : cond.ifMatch === null ? { onlyIfNew: true } : { onlyIfMatch: cond.ifMatch };
    const res = await this.store.setJSON(key, value, { ...conditions, metadata });
    return res.modified;
  }
}

/* ---------------- Local file store (dev only) ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FileKV implements KV {
  private dir: string;
  constructor(name: string, baseDir = join(tmpdir(), 'decklist-compare-kv')) {
    this.dir = join(baseDir, name);
  }
  private path(key: string) {
    return join(this.dir, encodeURIComponent(key) + '.json');
  }
  private async readRaw(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
  private static etagOf(raw: string | null) {
    return raw === null ? null : createHash('sha1').update(raw).digest('hex');
  }
  async get<T>(key: string): Promise<KVEntry<T>> {
    const raw = await this.readRaw(key);
    return { value: raw === null ? null : (JSON.parse(raw) as T), etag: FileKV.etagOf(raw) };
  }
  async set<T>(key: string, value: T, cond?: { ifMatch: string | null }): Promise<boolean> {
    await mkdir(this.dir, { recursive: true });
    const lock = this.path(key) + '.lock';
    // mkdir is atomic on every platform → cheap mutex.
    for (let i = 0; ; i++) {
      try {
        await mkdir(lock);
        break;
      } catch {
        if (i > 200) throw new Error(`FileKV: could not acquire lock for ${key}`);
        await sleep(5);
      }
    }
    try {
      if (cond !== undefined) {
        const current = FileKV.etagOf(await this.readRaw(key));
        if (current !== cond.ifMatch) return false;
      }
      const tmp = this.path(key) + '.tmp';
      await writeFile(tmp, JSON.stringify(value));
      await rename(tmp, this.path(key));
      return true;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

/* ---------------- Factory ---------------- */

const stores = new Map<string, KV>();

/** Returns the KV store for `name`, choosing the backend from the environment. */
export function createKV(name: string): KV {
  let kv = stores.get(name);
  if (!kv) {
    const onNetlify = process.env.NETLIFY === 'true' || !!process.env.NETLIFY_BLOBS_CONTEXT;
    kv = onNetlify ? new BlobsKV(name) : new FileKV(name);
    stores.set(name, kv);
  }
  return kv;
}
