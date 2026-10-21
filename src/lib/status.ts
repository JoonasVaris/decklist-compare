export interface TrafficStatus {
  busyMs: number;
  queuedCalls: number;
  minGapMs: number;
}

/** Reads the server's rate-limit schedule. Returns null when unavailable; never throws. */
export async function fetchTrafficStatus(signal?: AbortSignal): Promise<TrafficStatus | null> {
  try {
    const res = await fetch('/api/status', { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    if (typeof body?.busyMs !== 'number') return null;
    return body as TrafficStatus;
  } catch {
    return null;
  }
}
