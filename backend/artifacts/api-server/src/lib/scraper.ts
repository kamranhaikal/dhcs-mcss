import { deriveNewsIntelligence, type DerivedNewsIntelligence } from "./intelligence.js";

const GRAPHQL_URL = "https://mcweb.apps.prd.cammis.medi-cal.ca.gov/graphql";
const ENVIRONMENT_JS_URL =
  "https://mcweb.apps.prd.cammis.medi-cal.ca.gov/environment.js";
const BASE_URL = "https://mcweb.apps.prd.cammis.medi-cal.ca.gov";
const PAGE_SIZE = 100;

let cachedToken: string | null = null;

async function discoverToken(): Promise<string> {
  const res = await fetch(ENVIRONMENT_JS_URL, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch environment.js: ${res.status} ${res.statusText}`,
    );
  }
  const text = await res.text();
  const match = text.match(/DIRECTUS_TOKEN=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      "Could not find DIRECTUS_TOKEN in environment.js — the site may have changed.",
    );
  }
  return match[1];
}

async function getToken(): Promise<string> {
  if (process.env.MEDI_CAL_DIRECTUS_TOKEN) {
    return process.env.MEDI_CAL_DIRECTUS_TOKEN;
  }
  if (!cachedToken) {
    cachedToken = await discoverToken();
  }
  return cachedToken;
}

export interface NewsItem extends DerivedNewsIntelligence {
  title: string;
  link: string;
  summary: string;
  publishedDate: Date;
  revisedDate: Date | null;
  /**
   * Best-available literal timestamp (date + time) of when the item was posted at the
   * source. Falls back to noon on the publish date when the source only provides a date
   * (e.g. DHCS Public Notices PDFs, which are never time-stamped).
   */
  postedAt: Date;
  publishedLabel: string;
  categories: string[];
  /** Full HTML body of the article; null for bulletins */
  body: string | null;
  /** Primary month/year bucket (publish_date) — used for Excel sheet grouping */
  monthYear: string;
  /** All month/year buckets this item belongs to (publish + revision months if different) */
  monthYears: string[];
  /** Whether this item is a news article, a bulletin issue, a system status alert, or a DHCS public notice */
  source: "news" | "bulletin" | "alert" | "public_notice";
  /** Whether this item is regulatory guidance requiring MCP/RCM action, or merely informational */
  classification: "informational" | "regulatory";
  /** HP internal category tags derived from the DHCS category baseline mapping plus content analysis */
  hpMappings: string[];
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a publication as "regulatory" (requires MCP/RCM action — policy, billing,
 * coverage, rate changes) or "informational" (training, reminders, portal notices).
 *
 * Logic: strong informational signals (webinars, "coming soon", reminders) take
 * first priority. If none match, regulatory keywords are checked. Default is
 * "informational" when no signals are found.
 */
function classifyItem(
  title: string,
  summary: string,
  categories: string[],
): "informational" | "regulatory" {
  const text = `${title} ${summary} ${categories.join(" ")}`.toLowerCase();

  // Strong informational signals — override everything; no MCP action required
  const strongInformational: RegExp[] = [
    /\bcoming soon\b/,
    /\breminder:/,
    /\btraining event\b/,
    /\bin-person training\b/,
    /\bwebinar\b/,
    /\bnew (course|training)\b/,
    /scheduled (for|maintenance)\b/,
    /\bnew navigation\b/,
    /portal.*navigation/,
    /\bportal.*(enhancement|update)\b/,
    /\bpaperless\b/,
    /\bsystem upgrade\b/,
    /maintenance (period|window)\b/,
  ];
  if (strongInformational.some((p) => p.test(text))) return "informational";

  // Regulatory indicators — policy/billing/coverage changes requiring MCP action
  const regulatory: RegExp[] = [
    // Billing & coding
    /\bcpt\s*code/,
    /\bhcpcs\b/,
    /\bmodifier\b/,
    /\bfee schedule\b/,
    /\bbilling\b/,
    /\breimburs/,
    /payment (system|correction|rate)\b/,
    /\bdrg\b/,
    /\brate change\b/,
    /\ball-inclusive rate\b/,
    // Policy & regulatory
    /\bpolicy\b/,
    /\bnotice of change\b/,
    /\bregulat/,
    /\bmandate\b/,
    /\bnew requirement\b/,
    /\beffective date\b/,
    // Provider types & enrollment
    /\bnew provider type\b/,
    /provider type \d/,
    // Coverage & eligibility
    /\beligibility\b/,
    /\bcoverage\b/,
    /\bfederal poverty\b/,
    /\bfpl\b/,
    /\bpresumptive eligibility\b/,
    // MCP-specific
    /\bmanaged care\b/,
    /\bmcp\b/,
    // Claims & authorization
    /\bclaim form\b/,
    /\bauthorization\b/,
    // Quarter/annual code updates
    /\b(quarter|interim) (update|change)\b/,
  ];
  if (regulatory.some((p) => p.test(text))) return "regulatory";

  return "informational";
}

// ─── HP Category Mapping ──────────────────────────────────────────────────────

const DHCS_TO_HP: Record<string, string[]> = {
  "Allied Health":                                    ["Provider Operations"],
  "Outpatient Services":                              ["Program & Policy Updates"],
  "Acupuncture":                                      ["Program & Policy Updates"],
  "Medi-Cal Waiver Program":                          ["Special Populations"],
  "Audiology and Hearing Aids":                       ["Billing, Coding & Reimbursement"],
  "Clinics and Hospitals":                            ["Provider Operations"],
  "Chiropractic":                                     ["Program & Policy Updates"],
  "Chronic Dialysis Clinics":                         ["Provider Operations"],
  "Durable Medical Equipment and Medical Supplies":   ["Billing, Coding & Reimbursement"],
  "Community-Based Adult Services":                   ["Special Populations"],
  "Medical Transportation":                           ["Provider Operations"],
  "Heroin Detoxification":                            ["Special Populations"],
  "Orthotics and Prosthetics":                        ["Billing, Coding & Reimbursement"],
  "Home Health Agencies/Home Community-Based Services": ["Provider Operations"],
  "Psychological Services":                           ["Program & Policy Updates"],
  "Hospice Care Program":                             ["Special Populations"],
  "Inpatient Services":                               ["Billing, Coding & Reimbursement"],
  "Local Educational Agency":                         ["Special Populations"],
  "Long Term Care":                                   ["Special Populations"],
  "Multipurpose Senior Service Program":              ["Special Populations"],
  "Medical Services":                                 ["Program & Policy Updates"],
  "Rehabilitation Clinics":                           ["Provider Operations"],
  "General Medicine":                                 ["Program & Policy Updates"],
  "Additional Subject Areas":                         ["General Reminders & Informational Notices"],
  "Obstetrics":                                       ["Special Populations"],
  "California Children's Service":                    ["Special Populations"],
  "Pharmacy":                                         ["Billing, Coding & Reimbursement"],
  "Computer Media Claims/Electronic Data Interchange": ["Systems & Technology"],
  "Federally Qualified Health Centers/Rural Health Clinics": ["Provider Operations"],
  "Specialty Programs":                               ["Special Populations"],
  "Indian Health Services/Memorandum of Agreement":   ["Special Populations"],
  "Children's Presumptive Eligibility (CPE)":         ["Special Populations"],
  "Family PACT":                                      ["Special Populations"],
  "System Status Alerts":                             ["General Reminders & Informational Notices"],
  "State Plan Amendment":                             ["Program & Policy Updates"],
  "Outreach and Education":                           ["General Reminders & Informational Notices"],
  "DHCS Notice":                                      ["General Reminders & Informational Notices"],
};

const HP_CONTENT_KEYWORDS: Array<{ category: string; patterns: RegExp[] }> = [
  {
    category: "Billing, Coding & Reimbursement",
    patterns: [
      /\bbilling\b/, /\breimbursement\b/, /\bfee schedule\b/, /\bpayment rate\b/,
      /\bremittance\b/, /\brevenue code\b/, /\bhcpcs\b/, /\bcpt code\b/,
      /\bmodifier\b/, /\bco-pay\b/, /\bcopay\b/, /\bcost sharing\b/,
      /\bprocedure code\b/, /\btaxonomy code\b/, /\bndc code\b/, /\brate change\b/,
      /\bclaims submission\b/, /\bplace of service\b/,
    ],
  },
  {
    category: "Systems & Technology",
    patterns: [
      /\bportal\b/, /\bedi\b/, /\belectronic data interchange\b/, /\bcomputer media\b/,
      /\bcammis\b/, /\btransaction set\b/, /\bweb application\b/, /\bonline system\b/,
      /\belectronic submission\b/, /\bsystem (upgrade|update|maintenance|outage)\b/,
      /\bsoftware update\b/, /\bmedi-cal web\b/, /\bweb portal\b/, /\bprovider portal\b/,
    ],
  },
  {
    category: "Program & Policy Updates",
    patterns: [
      /\bpolicy (update|change|revision|memo)\b/, /\bregulat(ion|ory)\b/,
      /\bamendment\b/, /\bstate plan\b/, /\bwaiver (renewal|amendment)\b/,
      /\beffective date\b/, /\bcompliance requirement\b/, /\bfederal guidance\b/,
      /\blegislat(ion|ive)\b/, /\btitle xix\b/, /\bfederal register\b/,
      /\bfinal rule\b/, /\bwelfare and institutions\b/, /\bcoverage change\b/,
      /\bnew requirement\b/,
    ],
  },
  {
    category: "Special Populations",
    patterns: [
      /\bchild(ren)?\b/, /\bpediatric\b/, /\bmaternal\b/, /\bprenatal\b/, /\bpregnant\b/,
      /\bsenior\b/, /\belderly\b/, /\bolder adult\b/, /\bfoster care\b/,
      /\bhomeless\b/, /\bdisabilit(y|ies)\b/, /\bbehavioral health\b/, /\bmental health\b/,
      /\bsubstance use\b/, /\bsubstance abuse\b/, /\btribal\b/, /\bindigenous\b/,
      /\bindian health\b/, /\brefugee\b/, /\btransition age\b/, /\bfamily pact\b/,
      /\blow-income\b/, /\bfoster youth\b/,
    ],
  },
  {
    category: "Provider Operations",
    patterns: [
      /\benrollment\b/, /\bcredential(ing)?\b/, /\bnpi\b/, /\bprovider type\b/,
      /\bcertificat(ion|e)\b/, /\blicensure\b/, /\bprovider network\b/,
      /\bprior authorization\b/, /\bprovider manual\b/, /\bsite visit\b/,
      /\bprovider enrollment\b/, /\bcontracting\b/,
    ],
  },
  {
    category: "General Reminders & Informational Notices",
    patterns: [
      /\breminder\b/, /\btraining (event|opportunity|session)\b/, /\bwebinar\b/,
      /\boutreach\b/, /\bannouncement\b/, /\bnewsletter\b/,
      /\binformational notice\b/, /\bsurvey\b/, /\bworkshop\b/,
    ],
  },
];

function computeHpMappings(
  title: string,
  summary: string,
  categories: string[],
): string[] {
  const result = new Set<string>();

  for (const cat of categories) {
    const mapped = DHCS_TO_HP[cat];
    if (mapped) mapped.forEach((m) => result.add(m));
  }

  const searchText = `${title} ${summary}`.toLowerCase();
  for (const { category, patterns } of HP_CONTENT_KEYWORDS) {
    if (patterns.some((p) => p.test(searchText))) {
      result.add(category);
    }
  }

  return Array.from(result);
}

// ─── News Articles ───────────────────────────────────────────────────────────

const ALL_NEWS_QUERY = `
  query AllNewsArticlesPaged($offset: Int, $limit: Int) {
    news_articles(
      offset: $offset
      limit: $limit
      filter: {
        publish_date: { _lte: "$NOW" }
      }
      sort: ["-sort_date"]
    ) {
      article_id
      article_title
      article_summary
      article_body
      publish_date
      revision_date
      category {
        categories_id {
          category_name
        }
      }
    }
  }
`;

interface RawArticle {
  article_id: string;
  article_title: string;
  article_summary: string | null;
  article_body: string | null;
  publish_date: string;
  revision_date: string | null;
  category: Array<{ categories_id: { category_name: string } | null }> | null;
}

async function fetchNewsPage(token: string, offset: number): Promise<RawArticle[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: ALL_NEWS_QUERY,
      variables: { offset, limit: PAGE_SIZE },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { news_articles?: RawArticle[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return json.data?.news_articles ?? [];
}

/**
 * Parse a Directus timestamp string as a literal date.
 *
 * Directus returns timestamps without a timezone suffix (e.g. "2026-06-16T00:00:00").
 * On a UTC server, new Date("2026-06-16T00:00:00") is treated as UTC midnight,
 * which then shifts to June 15 at 5 pm PDT — wrong by a full calendar day.
 * The site is California state infrastructure; the date portion is authoritative
 * and should be read literally without any UTC→PT conversion.
 */
function parseIsoDate(isoDate: string): Date {
  const datePart = isoDate.split("T")[0]; // "2026-06-16"
  const [year, month, day] = datePart.split("-").map(Number);
  // Use noon local time so DST transitions never affect the calendar date.
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Parse a Directus timestamp literally, preserving hour/minute/second when present.
 * Directus timestamps are already California local time (see parseIsoDate above) —
 * any trailing "Z"/offset is source noise, not a real UTC marker, so it's stripped
 * before reading the digits. Falls back to noon when no time-of-day is present.
 */
function parsePostedAt(isoTimestamp: string): Date {
  const clean = isoTimestamp.replace(/(\.\d+)?Z$/, "").replace(/[+-]\d{2}:?\d{2}$/, "");
  const [datePart, timePart] = clean.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!timePart) return new Date(year, month - 1, day, 12, 0, 0);
  const [hourStr, minuteStr, secondStr] = timePart.split(":");
  return new Date(
    year,
    month - 1,
    day,
    Number(hourStr) || 0,
    Number(minuteStr) || 0,
    Number(secondStr) || 0,
  );
}

function formatDate(isoDate: string): string {
  return parseIsoDate(isoDate).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Strip HTML tags and decode common entities to produce plain text.
 * Used to auto-generate a summary from body content when article_summary is null.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNewsItem(raw: RawArticle): NewsItem {
  const publishedDate = parseIsoDate(raw.publish_date);
  const revisedDate = raw.revision_date ? parseIsoDate(raw.revision_date) : null;

  const wasRevised = revisedDate && revisedDate > publishedDate;
  const publishedLabel = wasRevised
    ? `Updated ${formatDate(raw.revision_date!)}`
    : `Published ${formatDate(raw.publish_date)}`;

  const categories = (raw.category ?? [])
    .map((c) => c.categories_id?.category_name)
    .filter((n): n is string => Boolean(n));

  // Primary bucket is always the publish month (used for Excel sheet grouping)
  const monthYear = publishedDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Include the revision month too so items updated in a later month appear
  // when filtering by that month in the dashboard.
  const monthYears = [monthYear];
  if (revisedDate && revisedDate > publishedDate) {
    const revMonthYear = revisedDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (revMonthYear !== monthYear) {
      monthYears.push(revMonthYear);
    }
  }

  // When article_summary is null but body exists, derive a summary from the
  // first ~1000 chars of plain body text so the Summary column is never empty.
  let summary = raw.article_summary ?? "";
  if (!summary && raw.article_body) {
    const plain = htmlToPlainText(raw.article_body);
    summary = plain.length > 1000 ? plain.slice(0, 1000) + "…" : plain;
  }

  return {
    title: raw.article_title,
    link: `${BASE_URL}/news/${raw.article_id}`,
    summary,
    body: raw.article_body ?? null,
    publishedDate,
    revisedDate,
    postedAt: parsePostedAt(raw.publish_date),
    publishedLabel,
    categories,
    monthYear,
    monthYears,
    source: "news",
    classification: classifyItem(raw.article_title, summary, categories),
    hpMappings: computeHpMappings(raw.article_title, summary, categories),
    ...deriveNewsIntelligence({ title: raw.article_title, summary, body: raw.article_body ?? null, publishedDate, revisedDate }),
  };
}

async function fetchAllNewsArticles(token: string): Promise<NewsItem[]> {
  const allRaw: RawArticle[] = [];

  const firstPage = await fetchNewsPage(token, 0);
  allRaw.push(...firstPage);

  if (firstPage.length === PAGE_SIZE) {
    const CHUNK = 5;
    let offset = PAGE_SIZE;

    while (true) {
      const offsets = Array.from(
        { length: CHUNK },
        (_, i) => offset + i * PAGE_SIZE,
      );

      const pages = await Promise.all(offsets.map((o) => fetchNewsPage(token, o)));

      let gotAny = false;
      for (const page of pages) {
        if (page.length > 0) {
          allRaw.push(...page);
          gotAny = true;
        }
      }

      if (!gotAny) break;

      const lastPage = pages[pages.length - 1];
      if (lastPage.length < PAGE_SIZE) break;

      offset += CHUNK * PAGE_SIZE;
    }
  }

  return allRaw.map(toNewsItem);
}

// ─── System Status Alerts ────────────────────────────────────────────────────

const ALL_ALERTS_QUERY = `
  query AllSystemAlerts {
    system_alert(
      filter: {
        status: { _eq: "published" }
        publish_date: { _nnull: true, _lte: "$NOW" }
      }
      sort: ["-publish_date"]
      limit: 500
    ) {
      id
      message_title
      alert_type
      publish_date
      resolved_date
      message_text
    }
  }
`;

interface RawAlert {
  id: string;
  message_title: string;
  alert_type: string | null;
  publish_date: string;
  resolved_date: string | null;
  message_text: string | null;
}

function toAlertItem(raw: RawAlert): NewsItem {
  const publishedDate = parseIsoDate(raw.publish_date);
  const resolvedDate = raw.resolved_date ? parseIsoDate(raw.resolved_date) : null;

  const publishedLabel = resolvedDate
    ? `Published ${formatDate(raw.publish_date)} · Resolved ${formatDate(raw.resolved_date!)}`
    : `Published ${formatDate(raw.publish_date)}`;

  const summary = raw.message_text
    ? (() => {
        const plain = htmlToPlainText(raw.message_text);
        return plain.length > 1000 ? plain.slice(0, 1000) + "…" : plain;
      })()
    : raw.message_title;

  const monthYear = publishedDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const monthYears = [monthYear];
  if (resolvedDate) {
    const resolvedMonthYear = resolvedDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (resolvedMonthYear !== monthYear) {
      monthYears.push(resolvedMonthYear);
    }
  }

  return {
    title: raw.message_title,
    link: `${BASE_URL}/system-status-alerts`,
    summary,
    body: raw.message_text ?? null,
    publishedDate,
    revisedDate: resolvedDate,
    postedAt: parsePostedAt(raw.publish_date),
    publishedLabel,
    categories: ["System Status Alerts"],
    monthYear,
    monthYears,
    source: "alert",
    classification: "informational" as const,
    hpMappings: computeHpMappings(raw.message_title, summary, ["System Status Alerts"]),
    ...deriveNewsIntelligence({ title: raw.message_title, summary, body: raw.message_text ?? null, publishedDate, revisedDate: resolvedDate }),
  };
}

async function fetchAllAlerts(token: string): Promise<NewsItem[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: ALL_ALERTS_QUERY }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed (alerts): ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { system_alert?: RawAlert[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors (alerts): ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return (json.data?.system_alert ?? []).map(toAlertItem);
}

// ─── Bulletins ───────────────────────────────────────────────────────────────

const ALL_BULLETINS_QUERY = `
  query AllBulletinsPaged($offset: Int, $limit: Int) {
    bulletins(
      offset: $offset
      limit: $limit
      filter: { status: { _eq: "published" } }
      sort: ["-publish_date"]
    ) {
      bulletin_id
      bulletin_title
      publish_date
      issue_number
      community {
        community_name
        community_abbrv
      }
      bulletin_content {
        bulletin_articles_bulletin_article_id {
          article_title
          article_body
        }
      }
    }
  }
`;

interface RawBulletin {
  bulletin_id: string;
  bulletin_title: string;
  publish_date: string;
  issue_number: number | null;
  community: { community_name: string; community_abbrv: string } | null;
  bulletin_content: Array<{
    bulletin_articles_bulletin_article_id: {
      article_title: string;
      article_body: string | null;
    } | null;
  }> | null;
}

async function fetchBulletinsPage(token: string, offset: number): Promise<RawBulletin[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: ALL_BULLETINS_QUERY,
      variables: { offset, limit: PAGE_SIZE },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed (bulletins): ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { bulletins?: RawBulletin[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors (bulletins): ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return json.data?.bulletins ?? [];
}

function toBulletinItem(raw: RawBulletin): NewsItem {
  const publishedDate = parseIsoDate(raw.publish_date);

  const publishedLabel = `Published ${formatDate(raw.publish_date)}`;

  const community = raw.community?.community_name;
  const categories = community ? [community] : [];

  const monthYear = publishedDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Build body HTML and summary from the articles within this bulletin.
  // Each article becomes a section: <h3> title + its article_body HTML.
  const articles = (raw.bulletin_content ?? [])
    .map((c) => c.bulletin_articles_bulletin_article_id)
    .filter((a): a is { article_title: string; article_body: string | null } => Boolean(a));

  const articleTitles = articles.map((a) => a.article_title);

  // Combine all article bodies into one HTML block
  const bodyParts = articles
    .map((a) => {
      const heading = `<h3>${a.article_title}</h3>`;
      return a.article_body ? `${heading}\n${a.article_body}` : heading;
    });
  const combinedBody = bodyParts.length > 0 ? bodyParts.join("\n\n") : null;

  const summary = articleTitles.length > 0
    ? `Contains ${articleTitles.length} article${articleTitles.length !== 1 ? "s" : ""}: ${articleTitles.slice(0, 3).join("; ")}${articleTitles.length > 3 ? `; and ${articleTitles.length - 3} more` : ""}.`
    : raw.bulletin_title;

  // The Medi-Cal site builds URLs as:
  //   slugify(community_name).toLowerCase() + optional &issueNumber=N
  // Matches the bundle.js pattern exactly — do NOT use community_abbrv (e.g. PART1) as the param.
  const communitySlug = community
    ? community.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : null;
  const issueNumber = raw.issue_number;
  const link = communitySlug
    ? `${BASE_URL}/publications/bulletin?community=${communitySlug}${issueNumber != null ? `&issueNumber=${issueNumber}` : ""}`
    : `${BASE_URL}/publications`;

  return {
    title: raw.bulletin_title,
    link,
    summary,
    body: combinedBody,
    publishedDate,
    revisedDate: null,
    postedAt: parsePostedAt(raw.publish_date),
    publishedLabel,
    categories,
    monthYear,
    monthYears: [monthYear],
    source: "bulletin",
    classification: "regulatory" as const,
    hpMappings: computeHpMappings(raw.bulletin_title, summary, categories),
    ...deriveNewsIntelligence({ title: raw.bulletin_title, summary, body: combinedBody, publishedDate, revisedDate: null }),
  };
}

async function fetchAllBulletins(token: string): Promise<NewsItem[]> {
  const allRaw: RawBulletin[] = [];

  const firstPage = await fetchBulletinsPage(token, 0);
  allRaw.push(...firstPage);

  if (firstPage.length === PAGE_SIZE) {
    const CHUNK = 5;
    let offset = PAGE_SIZE;

    while (true) {
      const offsets = Array.from(
        { length: CHUNK },
        (_, i) => offset + i * PAGE_SIZE,
      );

      const pages = await Promise.all(offsets.map((o) => fetchBulletinsPage(token, o)));

      let gotAny = false;
      for (const page of pages) {
        if (page.length > 0) {
          allRaw.push(...page);
          gotAny = true;
        }
      }

      if (!gotAny) break;

      const lastPage = pages[pages.length - 1];
      if (lastPage.length < PAGE_SIZE) break;

      offset += CHUNK * PAGE_SIZE;
    }
  }

  return allRaw.map(toBulletinItem);
}

// ─── DHCS Public Notices (State Plan Amendments) ─────────────────────────────
//
// These are NOT in the Directus/GraphQL backend used above — DHCS publishes them
// as plain HTML list pages on www.dhcs.ca.gov, one page per year, e.g.
// ".../public-notices-for-2026-proposed-state-plan-amendments/". That site sits
// behind Incapsula bot protection, which blocks a plain server-side fetch() with
// a JS-challenge page instead of real HTML — so we go through the r.jina.ai
// read-only reader proxy, which renders the page and returns clean markdown.

const DHCS_BASE_URL = "https://www.dhcs.ca.gov";
const READER_PROXY = "https://r.jina.ai/";
const PUBLIC_NOTICE_YEARS_BACK = 3; // matches DHCS's own "past three years" framing

function publicNoticeUrlForYear(year: number): string {
  return `${DHCS_BASE_URL}/forms-laws-publications/laws-and-regulations/public-notices-for-${year}-proposed-state-plan-amendments/`;
}

/** Matches a markdown bullet like: `*   [26-0020 (this is a pdf file)](URL) Proposes to ... (Released June 30, 2026)` */
const NOTICE_LINE_RE = /^\*\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(.*)$/;
const RELEASED_RE = /\((?:Released|Submitted on)\s+([A-Za-z]+ \d{1,2},\s*\d{4})\)\s*\.?\s*$/;
const SPA_NUMBER_RE = /(\d{2}-\d{4}(?:-[A-Za-z])?)/;

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
}

interface RawPublicNotice {
  spaNumber: string;
  isAddendum: boolean;
  description: string;
  releasedLabel: string;
  releasedDate: Date;
  link: string;
  year: number;
}

function parsePublicNoticesMarkdown(markdown: string, year: number): RawPublicNotice[] {
  const results: RawPublicNotice[] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const lineMatch = line.match(NOTICE_LINE_RE);
    if (!lineMatch) continue;

    const [, label, url, rest] = lineMatch;
    const releasedMatch = rest.match(RELEASED_RE);
    if (!releasedMatch) continue; // skip lines we can't confidently date

    const spaMatch = label.match(SPA_NUMBER_RE);
    if (!spaMatch) continue; // skip lines without an identifiable SPA number

    const description = stripMarkdownLinks(rest.slice(0, releasedMatch.index));
    const releasedLabel = releasedMatch[1];
    const releasedDate = new Date(releasedLabel + " 12:00:00");
    if (Number.isNaN(releasedDate.getTime())) continue;

    results.push({
      spaNumber: spaMatch[1],
      isAddendum: /addendum/i.test(label),
      description: description || label,
      releasedLabel,
      releasedDate,
      link: url,
      year,
    });
  }
  return results;
}

async function fetchPublicNoticesForYear(year: number): Promise<RawPublicNotice[]> {
  const targetUrl = publicNoticeUrlForYear(year);
  try {
    const res = await fetch(`${READER_PROXY}${targetUrl}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const markdown = await res.text();
    return parsePublicNoticesMarkdown(markdown, year);
  } catch {
    // A missing/unreachable year page should never take down the whole feed.
    return [];
  }
}

function toPublicNoticeItem(raw: RawPublicNotice): NewsItem {
  const title = `SPA ${raw.spaNumber}${raw.isAddendum ? " Addendum" : ""} Public Notice`;
  const publishedDate = new Date(
    raw.releasedDate.getFullYear(),
    raw.releasedDate.getMonth(),
    raw.releasedDate.getDate(),
    12,
    0,
    0,
  );
  const monthYear = publishedDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  return {
    title,
    link: raw.link,
    summary: raw.description,
    body: null,
    publishedDate,
    revisedDate: null,
    postedAt: publishedDate,
    publishedLabel: `Released ${raw.releasedLabel}`,
    categories: ["State Plan Amendment"],
    monthYear,
    monthYears: [monthYear],
    source: "public_notice",
    classification: "regulatory" as const,
    hpMappings: computeHpMappings(title, raw.description, ["State Plan Amendment"]),
    ...deriveNewsIntelligence({ title, summary: raw.description, body: null, publishedDate, revisedDate: null }),
  };
}

async function fetchAllPublicNotices(): Promise<NewsItem[]> {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: PUBLIC_NOTICE_YEARS_BACK }, (_, i) => currentYear - i);

  const pages = await Promise.all(years.map(fetchPublicNoticesForYear));
  const all = pages.flat();

  // DHCS republishes addenda as separate line items referencing the same SPA number
  // and PDF URL; de-dupe on link so an unchanged page re-fetch never creates dupes.
  const seen = new Set<string>();
  const deduped: RawPublicNotice[] = [];
  for (const item of all) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }

  return deduped.map(toPublicNoticeItem);
}

// ─── Combined ─────────────────────────────────────────────────────────────────

export async function scrapeAllNews(): Promise<NewsItem[]> {
  const token = await getToken();

  // Fetch news articles, bulletins, system status alerts, and DHCS public notices in parallel.
  // Public notices come from a separate site (see above) and are resilient to failure —
  // if DHCS or the reader proxy is unreachable, the rest of the feed still loads.
  const [newsItems, bulletinItems, alertItems, publicNoticeItems] = await Promise.all([
    fetchAllNewsArticles(token),
    fetchAllBulletins(token),
    fetchAllAlerts(token),
    fetchAllPublicNotices().catch((err) => {
      console.error("Failed to fetch DHCS public notices:", err);
      return [] as NewsItem[];
    }),
  ]);

  const all = [...newsItems, ...bulletinItems, ...alertItems, ...publicNoticeItems];

  return all.sort(
    (a, b) => b.publishedDate.getTime() - a.publishedDate.getTime(),
  );
}

export function groupByMonth(
  items: NewsItem[],
): Map<string, { date: Date; items: NewsItem[] }> {
  const map = new Map<string, { date: Date; items: NewsItem[] }>();
  for (const item of items) {
    // Group strictly by publish_date month/year
    if (!map.has(item.monthYear)) {
      map.set(item.monthYear, { date: item.publishedDate, items: [] });
    }
    map.get(item.monthYear)!.items.push(item);
  }
  // Sort newest month first
  return new Map(
    [...map.entries()].sort(
      (a, b) => b[1].date.getTime() - a[1].date.getTime(),
    ),
  );
}
