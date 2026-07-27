import type { ListNewsParams, NewsItem, NewsListResponse } from "@workspace/api-client-react";

export type SubscriptionFilters = Pick<ListNewsParams, "q" | "category" | "month" | "source" | "classification" | "hpMapping">;

export function stableItemId(item: Pick<NewsItem, "id" | "link" | "postedAt" | "title">): string {
  return item.id || `${item.link}-${item.postedAt}-${item.title}`;
}

export function flattenNewsPages(pages: NewsListResponse[] | undefined): NewsItem[] {
  const seen = new Set<string>();
  return (pages ?? []).flatMap((page) => page.items).filter((item) => {
    const id = stableItemId(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function buildSubscriptionUrl(path: string, filters: SubscriptionFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set("limit", "200");
  return `${path}?${params.toString()}`;
}
