import { describe, expect, it } from "vitest";
import type { NewsItem, NewsListResponse } from "@workspace/api-client-react";
import { buildSubscriptionUrl, flattenNewsPages, stableItemId } from "./news-feed";

const item = (id: string): NewsItem => ({
  id,
  title: `Update ${id}`,
  link: `https://example.test/${id}`,
  summary: "Summary",
  publishedDate: "2026-07-01",
  postedAt: "2026-07-01T12:00:00.000Z",
  publishedLabel: "July 1, 2026",
  categories: [],
  monthYear: "July 2026",
  source: "news",
  classification: "informational",
  hpMappings: [],
  affectedEntities: [],
  actionRequired: false,
  actionSummary: null,
  effectiveDate: null,
  deadlineDate: null,
  keyPrograms: [],
  changeStatus: "new",
  extractionConfidence: "low",
});

describe("news feed utilities", () => {
  it("builds a filtered subscription URL with the server-supported filters and a 200-item limit", () => {
    const url = buildSubscriptionUrl("/api/rss.xml", {
      q: "prior authorization",
      category: "Provider Operations",
      month: "July 2026",
      source: "bulletin",
      classification: "regulatory",
      hpMapping: "Systems & Technology",
    });

    expect(url).toBe("/api/rss.xml?q=prior+authorization&category=Provider+Operations&month=July+2026&source=bulletin&classification=regulatory&hpMapping=Systems+%26+Technology&limit=200");
  });

  it("omits empty filters and does not serialize the local bookmarks view", () => {
    expect(buildSubscriptionUrl("/api/feed.json", {
      q: "",
      category: undefined,
      month: undefined,
      source: undefined,
      classification: undefined,
      hpMapping: undefined,
    })).toBe("/api/feed.json?limit=200");
  });

  it("flattens pages in fetch order and removes duplicate stable IDs", () => {
    const pages: NewsListResponse[] = [
      { items: [item("one"), item("two")], total: 3, limit: 25, offset: 0, hasMore: true },
      { items: [item("two"), item("three")], total: 3, limit: 25, offset: 25, hasMore: false },
    ];

    expect(flattenNewsPages(pages).map((entry) => entry.id)).toEqual(["one", "two", "three"]);
  });

  it("uses a generated stable ID and retains legacy fallback identity", () => {
    expect(stableItemId(item("official-id"))).toBe("official-id");
    expect(stableItemId({ ...item(""), title: "Legacy", link: "https://legacy.test", postedAt: "2026-07-02T00:00:00.000Z" })).toBe("https://legacy.test-2026-07-02T00:00:00.000Z-Legacy");
  });
});
