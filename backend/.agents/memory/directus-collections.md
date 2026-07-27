---
name: Directus collection overview
description: What collections exist in Directus and which ones the scraper uses
---

## Collections tracked by our scraper
- `news_articles` — provider news; has `publish_date`, `sort_date`, `revision_date`
- `bulletins` — monthly bulletins per community; has `publish_date` only (no sort_date/revision_date)
- `system_alert` — system status alerts; has `publish_date`, `resolved_date`, `message_title`, `message_text`, `alert_type`

## system_alert notes
- `publish_date` can be null (skip these — can't determine month)
- `resolved_date` is used as `revisedDate`; if it differs from publish month, item appears in both months
- Link: always `${BASE_URL}/system-status-alerts` (no individual URLs)
- Total records: ~4 (small collection)
- Filter: `status=published AND publish_date != null AND publish_date <= $NOW`

**Why:** User confirmed April 2026 count of 51 = 26 bulletins + 23 news + 2 system alerts

## Other collections (not tracked — static/no publish_date)
- `manuals` — uses date_created/date_updated only, not time-stamped publications
- `release_note` — has a `date` field but not part of the publications feed
- `reference_link`, `reference_document` — static reference links/docs

## 4th source: DHCS Public Notices (NOT in Directus)
- These are State Plan Amendment (SPA) notices; they live only on `www.dhcs.ca.gov`, a separate WordPress site with no Directus/GraphQL backing.
- Page format: `https://www.dhcs.ca.gov/forms-laws-publications/laws-and-regulations/public-notices-for-{YEAR}-proposed-state-plan-amendments/` (one page per year, site keeps ~3 years).
- `www.dhcs.ca.gov` sits behind Incapsula bot protection — direct `fetch()`/`curl` gets a JS-challenge page, not real HTML. Route requests through the free `https://r.jina.ai/<targetUrl>` reader proxy instead, which renders and returns clean markdown.
- Each notice has only a release *date*, never a time-of-day — the "postedAt" timestamp for these items always falls back to noon.
