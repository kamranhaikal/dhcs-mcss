import assert from "node:assert/strict";
import test from "node:test";
import type { NewsItem } from "../lib/scraper.js";
import { buildItemHtml, feedItems, feedOrigin } from "./rss.js";

const item = (source: NewsItem["source"], hpMappings: string[]): NewsItem => ({
  title: source,
  link: `https://example.test/${source}`,
  summary: "Summary",
  body: null,
  publishedDate: new Date("2026-01-01T00:00:00Z"),
  revisedDate: null,
  postedAt: new Date("2026-01-01T00:00:00Z"),
  publishedLabel: "January 1, 2026",
  categories: ["Policy"],
  monthYear: "January 2026",
  monthYears: ["January 2026"],
  source,
  classification: "informational",
  hpMappings,
  affectedEntities: [],
  actionRequired: false,
  actionSummary: null,
  effectiveDate: null,
  deadlineDate: null,
  keyPrograms: [],
  changeStatus: "new",
  extractionConfidence: "low",
});

test("feedItems preserves the legacy complete RSS feed while JSON defaults to 200", () => {
  const all = Array.from({ length: 201 }, (_, index) => item(index === 0 ? "alert" : "news", []));
  assert.equal(feedItems({}, all, null)?.length, 201);
  assert.equal(feedItems({}, all, 200)?.length, 200);
  assert.equal(feedItems({ limit: "2000" }, all, null)?.length, 201);
});

test("feedItems validates limits, enums, booleans, and dashboard filters", () => {
  const all = [item("alert", ["Provider Operations"]), item("news", [])];
  assert.equal(feedItems({ limit: "2001" }, all, null), undefined);
  assert.equal(feedItems({ source: "typo" }, all, null), undefined);
  assert.equal(feedItems({ classification: "private" }, all, null), undefined);
  assert.equal(feedItems({ fullArchive: "sometimes" }, all, 200), undefined);
  assert.deepEqual(feedItems({ source: "alert", hpMapping: "Provider Operations" }, all, null), [all[0]]);
  const otherMonth = { ...item("news", []), monthYears: ["February 2026"] };
  assert.deepEqual(feedItems({ month: "January 2026" }, [...all, otherMonth], null), all);
});

test("buildItemHtml escapes inferred and source text instead of emitting executable markup", () => {
  const unsafe = {
    ...item("news", ["Provider <script>alert(1)</script>"]),
    summary: "Summary <img src=x onerror=alert(1)>",
    body: "<p>Safe body</p><script>alert(2)</script>",
    actionRequired: true,
    actionSummary: "Providers must <img src=x onerror=alert(3)> submit claims.",
    affectedEntities: ["Providers <svg onload=alert(4)>"]
  } satisfies NewsItem;

  const html = buildItemHtml(unsafe, true);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("onerror="), false);
  assert.equal(html.includes("onload="), false);
  assert.match(html, /Safe body/);
});

test("feedOrigin prefers PUBLIC_ORIGIN, else the request host", () => {
  const saved = process.env.PUBLIC_ORIGIN;
  try {
    process.env.PUBLIC_ORIGIN = "https://dhcs-mcss.duckdns.org/";
    assert.equal(feedOrigin("some.host"), "https://dhcs-mcss.duckdns.org");
    delete process.env.PUBLIC_ORIGIN;
    assert.equal(feedOrigin("dhcs-mcss.duckdns.org"), "https://dhcs-mcss.duckdns.org");
    assert.equal(feedOrigin(undefined), "https://dhcs-mcss.duckdns.org");
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = saved;
  }
});
