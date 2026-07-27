import { createHash } from "node:crypto";
import type { NewsItem } from "./scraper.js";
import { searchNewsItems } from "./intelligence.js";

export type NewsListItem = Omit<NewsItem, "body"> & { id: string; body: string | null };

export function newsItemId(item: Pick<NewsItem, "link" | "title">): string {
  // link alone is not unique: system-status alerts all share one URL, so two
  // different alerts collided into one id; title disambiguates them
  return createHash("sha256").update(`${item.link}\n${item.title}`).digest("base64url");
}

export function toListItem(item: NewsItem, includeBody: boolean): NewsListItem {
  return { ...item, id: newsItemId(item), body: includeBody ? item.body : null };
}

export function findNewsItem(items: NewsItem[], id: string): NewsItem | undefined {
  return /^[A-Za-z0-9_-]{43}$/.test(id)
    ? items.find((item) => newsItemId(item) === id)
    : undefined;
}

export interface NewsListOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedNewsList {
  items: NewsItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface LegacyNewsList {
  items: NewsItem[];
  total: number;
}

export interface NewsFilterOptions {
  q?: string;
  category?: string;
  month?: string;
  source?: NewsItem["source"];
  classification?: NewsItem["classification"];
  hpMapping?: string;
}

export function filterNewsItems(items: NewsItem[], filters: NewsFilterOptions): NewsItem[] {
  const filtered = items.filter((item) => {
    if (filters.source && item.source !== filters.source) return false;
    if (filters.classification && item.classification !== filters.classification) return false;
    if (filters.category && !item.categories.includes(filters.category)) return false;
    if (filters.month && !item.monthYears.includes(filters.month)) return false;
    if (filters.hpMapping && !item.hpMappings.includes(filters.hpMapping)) return false;
    return true;
  });

  return filters.q ? searchNewsItems(filtered, filters.q).map((result) => result.item) : filtered;
}

export function listNewsItems(
  items: NewsItem[],
  options: NewsListOptions,
): PaginatedNewsList | LegacyNewsList {
  if (options.limit === undefined) {
    return { items, total: items.length };
  }

  const offset = options.offset ?? 0;
  return {
    items: items.slice(offset, offset + options.limit),
    total: items.length,
    limit: options.limit,
    offset,
    hasMore: offset + options.limit < items.length,
  };
}
