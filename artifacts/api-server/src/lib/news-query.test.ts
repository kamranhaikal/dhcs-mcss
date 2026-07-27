import assert from "node:assert/strict";
import test from "node:test";
import type { NewsItem } from "./scraper.js";
import { filterNewsItems, findNewsItem, listNewsItems, toListItem } from "./news-query.js";

const item = (title: string, body: string | null = null): NewsItem => ({
  title,
  link: `https://mcweb.apps.prd.cammis.medi-cal.ca.gov/publications/${encodeURIComponent(title)}`,
  summary: "Summary",
  publishedDate: new Date("2026-01-01T00:00:00.000Z"),
  revisedDate: null,
  postedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedLabel: "January 1, 2026",
  categories: ["Policy"],
  monthYear: "January 2026",
  monthYears: ["January 2026"],
  body,
  source: "news",
  classification: "regulatory",
  hpMappings: ["Program & Policy Updates"],
  affectedEntities: [],
  actionRequired: false,
  actionSummary: null,
  effectiveDate: null,
  deadlineDate: null,
  keyPrograms: [],
  changeStatus: "new",
  extractionConfidence: "low",
});

test("listNewsItems paginates only when limit is supplied", () => {
  const items = [item("First"), item("Second"), item("Third")];

  assert.deepEqual(listNewsItems(items, { limit: 1, offset: 1 }), {
    items: [item("Second")],
    total: 3,
    limit: 1,
    offset: 1,
    hasMore: true,
  });
  assert.deepEqual(listNewsItems(items, {}), { items, total: 3 });
});

test("filterNewsItems finds case-insensitive body text and hp mappings", () => {
  const bodyMatch = item("Unrelated", "The COMPLETE POLICY is available here.");
  const mappingMatch = { ...item("Mapped"), hpMappings: ["Provider Operations"] };

  assert.deepEqual(filterNewsItems([bodyMatch, mappingMatch], { q: "policy" }), [bodyMatch]);
  assert.deepEqual(filterNewsItems([bodyMatch, mappingMatch], { hpMapping: "Provider Operations" }), [mappingMatch]);
});

test("toListItem omits body without accepting a caller-supplied URL for lookup", () => {
  const complete = item("Complete", "full article body");
  const listItem = toListItem(complete, false);

  assert.equal(listItem.body, null);
  assert.match(listItem.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(findNewsItem([complete], listItem.id), complete);
  assert.equal(findNewsItem([complete], "https://example.test/private"), undefined);
});
