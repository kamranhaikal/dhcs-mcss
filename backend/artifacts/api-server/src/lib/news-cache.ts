import { scrapeAllNews, type NewsItem } from "./scraper.js";
import { logger } from "./logger.js";

export interface NewsCache<T> {
  get(): Promise<T>;
}

export function createNewsCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  maxStaleMs = 30 * 60 * 1000,
  now: () => number = Date.now,
): NewsCache<T> & { warm(): Promise<T>; isRefreshing(): boolean } {
  let cached!: T;
  let hasCached = false;
  let cachedAt = 0;
  let pending: Promise<T> | undefined;

  function refresh(): Promise<T> {
    pending ??= load()
      .then((value) => {
        cached = value;
        hasCached = true;
        cachedAt = now();
        return value;
      })
      .catch((error) => {
        if (hasCached && now() - cachedAt <= maxStaleMs) return cached;
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  return {
    async get(): Promise<T> {
      const age = now() - cachedAt;
      if (hasCached && age < ttlMs) return cached;

      if (hasCached && age <= maxStaleMs) {
        // Stale-while-revalidate: expired but within the stale window — serve the
        // last good value now and let the refresh (deduped via `pending`) run behind it.
        void refresh().catch(() => {});
        return cached;
      }

      // No cached value yet, or too stale to serve — caller waits for a fresh load.
      return refresh();
    },
    warm(): Promise<T> {
      return refresh();
    },
    isRefreshing(): boolean {
      return pending !== undefined;
    },
  };
}

const TTL_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 60 * 60 * 1000;
const WARMUP_INTERVAL_MS = 4.5 * 60 * 1000;

const cache = createNewsCache<NewsItem[]>(scrapeAllNews, TTL_MS, MAX_STALE_MS);

export function getNews(): Promise<NewsItem[]> {
  return cache.get();
}

let warmupStarted = false;

// Keeps the cache warm even with zero traffic: an eager fetch at boot plus a
// standing interval just under the TTL, so real requests almost always land
// inside the fresh window instead of relying on stale-while-revalidate.
export function startNewsCacheWarmup(): void {
  if (warmupStarted) return;
  warmupStarted = true;

  cache
    .warm()
    .then((items) => logger.info({ count: items.length }, "News cache warmed up"))
    .catch((err) => logger.error({ err }, "Initial news cache warmup failed"));

  setInterval(() => {
    if (cache.isRefreshing()) return;
    cache
      .warm()
      .then((items) => logger.info({ count: items.length }, "News cache refreshed"))
      .catch((err) => logger.error({ err }, "Background news cache refresh failed"));
  }, WARMUP_INTERVAL_MS).unref();
}
