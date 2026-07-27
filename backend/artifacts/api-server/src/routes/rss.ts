import { Router } from "express";
import { load } from "cheerio";
import RSS from "rss";
import { type NewsItem } from "../lib/scraper.js";
import { getNews } from "../lib/news-cache.js";
import { filterNewsItems } from "../lib/news-query.js";
import { logger } from "../lib/logger.js";

const JSON_DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const SOURCES = new Set<NewsItem["source"]>(["news", "bulletin", "alert", "public_notice"]);
const CLASSIFICATIONS = new Set<NewsItem["classification"]>(["informational", "regulatory"]);
const DEFAULT_ORIGIN = "https://dhcs-mcss.duckdns.org";

function scalar(query: Record<string, unknown>, name: string): string | undefined | null {
  const raw = query[name];
  if (raw === undefined || raw === "all") return undefined;
  return typeof raw === "string" ? raw : null;
}

export function feedItems(
  query: Record<string, unknown>,
  allItems: NewsItem[],
  defaultLimit: number | null,
): NewsItem[] | undefined {
  const rawLimit = scalar(query, "limit");
  const rawFullArchive = scalar(query, "fullArchive");
  const source = scalar(query, "source");
  const classification = scalar(query, "classification");
  const category = scalar(query, "category");
  const month = scalar(query, "month");
  const hpMapping = scalar(query, "hpMapping");
  const q = scalar(query, "q");

  if (rawLimit === null || rawFullArchive === null || source === null || classification === null || category === null || month === null || hpMapping === null || q === null) return undefined;
  if (source && !SOURCES.has(source as NewsItem["source"])) return undefined;
  if (classification && !CLASSIFICATIONS.has(classification as NewsItem["classification"])) return undefined;
  if (rawFullArchive !== undefined && rawFullArchive !== "true" && rawFullArchive !== "false") return undefined;

  let limit = defaultLimit;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit)) return undefined;
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) return undefined;
  }

  const filtered = filterNewsItems(allItems, {
    q,
    source: source as NewsItem["source"] | undefined,
    category,
    month,
    classification: classification as NewsItem["classification"] | undefined,
    hpMapping,
  });
  return rawFullArchive === "true" || limit === null ? filtered : filtered.slice(0, limit);
}

export function feedOrigin(hostHeader: string | undefined): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = hostHeader?.toLowerCase().split(":")[0];
  return host ? `https://${host}` : DEFAULT_ORIGIN;
}

function sourceLabel(source: string): string {
  if (source === "bulletin") return "Bulletin";
  if (source === "alert") return "System Alert";
  if (source === "public_notice") return "DHCS Public Notice";
  return "News";
}

function sourceColor(source: string): { bg: string; text: string; border: string } {
  if (source === "bulletin") return { bg: "#FFFBEB", text: "#92400E", border: "#FCD34D" };
  if (source === "alert") return { bg: "#FEF2F2", text: "#991B1B", border: "#FCA5A5" };
  if (source === "public_notice") return { bg: "#F5F3FF", text: "#5B21B6", border: "#DDD6FE" };
  return { bg: "#EFF6FF", text: "#1E40AF", border: "#BFDBFE" };
}

function classColor(cls: string): { bg: string; text: string; border: string } {
  if (cls === "regulatory") return { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA" };
  return { bg: "#F0FDFA", text: "#0F766E", border: "#99F6E4" };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function sourceText(value: string): string {
  return load(value).text().replace(/\s+/g, " ").trim();
}

function safeText(value: string): string {
  return escapeHtml(sourceText(value));
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? escapeHtml(url.href) : "#";
  } catch {
    return "#";
  }
}

function badge(label: string, colors: { bg: string; text: string; border: string }): string {
  return `<span style="display:inline-block;background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:5px;">${escapeHtml(label)}</span>`;
}

function formatDate(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  let hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month}/${day}/${year} ${hours}:${minutes} ${period}`;
}

export function buildItemHtml(item: NewsItem, includeBody: boolean): string {
  const sourceBadge = badge(sourceLabel(item.source), sourceColor(item.source));
  const classificationBadge = badge(item.classification === "regulatory" ? "Regulatory" : "Informational", classColor(item.classification));
  const categories = item.categories.length > 0
    ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">DHCS Category:</strong> ${item.categories.map(safeText).join(", ")}</p>`
    : "";
  const hpMappings = item.hpMappings.length > 0
    ? `<p style="margin:0 0 10px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">HP Mapping:</strong> ${item.hpMappings.map(safeText).join(", ")}</p>`
    : "";
  const inferred = `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Change:</strong> ${escapeHtml(item.changeStatus)} · <strong style="color:#374151;">Action required:</strong> ${item.actionRequired ? "Yes" : "No"} · <strong style="color:#374151;">Inference confidence:</strong> ${escapeHtml(item.extractionConfidence)}</p>`
    + (item.actionSummary ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Action (inferred from source):</strong> ${safeText(item.actionSummary)}</p>` : "")
    + (item.effectiveDate ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Effective (source wording):</strong> ${safeText(item.effectiveDate)}</p>` : "")
    + (item.deadlineDate ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Deadline (source wording):</strong> ${safeText(item.deadlineDate)}</p>` : "")
    + (item.affectedEntities.length ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Affected entities (inferred):</strong> ${item.affectedEntities.map(safeText).join(", ")}</p>` : "")
    + (item.keyPrograms.length ? `<p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Key programs (source terms):</strong> ${item.keyPrograms.map(safeText).join(", ")}</p>` : "");
  const summary = item.summary
    ? `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.65;color:#1F2937;">${safeText(item.summary)}</p>`
    : "";
  const body = includeBody && item.body
    ? `<div style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#374151;border-top:1px solid #E5E7EB;padding-top:14px;">${safeText(item.body)}</div>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;padding:4px 0;">
    <p style="margin:0 0 12px 0;">${sourceBadge}${classificationBadge}</p>
    ${summary}
    <p style="margin:0 0 14px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Published:</strong> ${formatDate(new Date(item.publishedDate))}</p>
    <p style="margin:0 0 14px 0;font-size:12px;color:#6B7280;"><strong style="color:#374151;">Time Posted:</strong> ${formatDate(new Date(item.postedAt))}</p>
    ${categories}
    ${hpMappings}
    ${inferred}
    ${body}
    <p style="margin:16px 0 0 0;padding-top:14px;border-top:1px solid #E5E7EB;"><a href="${safeUrl(item.link)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">&#8594; Read full article on Medi-Cal website</a></p>
  </div>`;
}

const rssRouter = Router();

rssRouter.get("/rss.xml", async (req, res) => {
  try {
    const items = feedItems(req.query, await getNews(), null);
    if (!items) {
      res.status(400).json({ error: "Invalid RSS feed query parameters" });
      return;
    }

    logger.info({ returned: items.length }, "Fetching news for RSS feed");
    const baseUrl = feedOrigin(req.get("host"));
    const feed = new RSS({
      title: "Medi-Cal Publications – News",
      description: "Latest news and updates from the Medi-Cal publications website",
      feed_url: `${baseUrl}/api/rss.xml`,
      site_url: "https://mcweb.apps.prd.cammis.medi-cal.ca.gov/publications",
      language: "en",
      pubDate: items[0]?.publishedDate ?? new Date(),
      ttl: 5,
    });

    for (const item of items) {
      feed.item({
        title: item.title,
        url: item.link,
        description: buildItemHtml(item, false),
        date: item.publishedDate,
        categories: [...item.categories, item.classification],
        custom_elements: [{ "content:encoded": { _cdata: buildItemHtml(item, true) } }],
      });
    }

    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    res.send(feed.xml({ indent: true }));
  } catch (error) {
    logger.error(error, "Failed to generate RSS feed");
    res.status(500).json({ error: "Failed to generate RSS feed" });
  }
});

rssRouter.get("/feed.json", async (req, res) => {
  try {
    const items = feedItems(req.query, await getNews(), JSON_DEFAULT_LIMIT);
    if (!items) {
      res.status(400).json({ error: "Invalid JSON feed query parameters" });
      return;
    }

    logger.info({ returned: items.length }, "Fetching news for JSON feed");
    const baseUrl = feedOrigin(req.get("host"));
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    res.json({
      title: "Medi-Cal Publications – News",
      description: "Latest news and updates from the Medi-Cal publications website",
      feedUrl: `${baseUrl}/api/feed.json`,
      siteUrl: "https://mcweb.apps.prd.cammis.medi-cal.ca.gov/publications",
      generatedAt: new Date().toISOString(),
      totalReturned: items.length,
      items: items.map((item) => ({
        title: item.title,
        url: item.link,
        summary: item.summary || "",
        publishedDate: formatDate(new Date(item.publishedDate)),
        postedAt: formatDate(new Date(item.postedAt)),
        source: item.source,
        classification: item.classification,
        categories: item.categories,
        hpMappings: item.hpMappings,
        affectedEntities: item.affectedEntities,
        actionRequired: item.actionRequired,
        actionSummary: item.actionSummary,
        effectiveDate: item.effectiveDate,
        deadlineDate: item.deadlineDate,
        keyPrograms: item.keyPrograms,
        changeStatus: item.changeStatus,
        extractionConfidence: item.extractionConfidence,
      })),
    });
  } catch (error) {
    logger.error(error, "Failed to generate JSON feed");
    res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

export default rssRouter;
