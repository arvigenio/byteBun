// In-process memory cache (like .NET's IMemoryCache) for read-heavy results: the admin lead and
// booking lists, and the public booking slots.
//
//  - Entries live for a short TTL and are grouped in namespaces ("leads", "bookings", "slots").
//  - invalidate("leads") drops a whole namespace at once: it bumps the namespace's version, so
//    every key built with the old version is never read again (and ages out).
//  - Concurrent misses for the same key share one load (no stampede on the database).
//  - It lives in this API process. With more than one API instance, each has its own cache and
//    only sees its own invalidations; switch to Redis then.
import { Injectable } from '@nestjs/common';

export type CacheNamespace = 'leads' | 'bookings' | 'slots';

interface Entry {
  value: Promise<unknown>;
  expires: number;
}

const MAX_ENTRIES = 1000;

@Injectable()
export class MemoryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly versions = new Map<CacheNamespace, number>();
  readonly stats = { hits: 0, misses: 0, invalidations: 0 };

  private fullKey(ns: CacheNamespace, key: string) {
    return `${ns}:v${this.versions.get(ns) ?? 0}:${key}`;
  }

  async getOrSet<T>(ns: CacheNamespace, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const k = this.fullKey(ns, key);
    const now = Date.now();
    const hit = this.entries.get(k);
    if (hit && hit.expires > now) {
      this.stats.hits++;
      return hit.value as Promise<T>;
    }
    this.stats.misses++;
    const value = load();
    this.entries.set(k, { value, expires: now + ttlMs });
    value.catch(() => this.entries.delete(k)); // never cache a failure
    this.prune(now);
    return value;
  }

  /** Drops everything cached in these namespaces. */
  invalidate(...namespaces: CacheNamespace[]) {
    for (const ns of namespaces) this.versions.set(ns, (this.versions.get(ns) ?? 0) + 1);
    this.stats.invalidations++;
    // Old-version keys are unreachable now; remove them right away.
    for (const k of this.entries.keys()) {
      const [ns, v] = k.split(':', 2);
      if (namespaces.includes(ns as CacheNamespace) && v !== `v${this.versions.get(ns as CacheNamespace)}`) this.entries.delete(k);
    }
  }

  clear() {
    this.entries.clear();
  }

  private prune(now: number) {
    if (this.entries.size <= MAX_ENTRIES) return;
    for (const [k, e] of this.entries) if (e.expires <= now) this.entries.delete(k);
    // Still too big: drop the oldest (Map keeps insertion order).
    for (const k of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(k);
    }
  }
}
