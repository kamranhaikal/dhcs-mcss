export interface NewsIntelligenceInput {
  title: string;
  summary: string;
  body: string | null;
  publishedDate: Date;
  revisedDate: Date | null;
}

/**
 * Deterministic, provenance-aware fields inferred only from source publication
 * text and dates. Values preserve literal source wording; empty/null means no
 * bounded, explicit evidence was found. These are not DHCS-authored fields.
 */
export interface DerivedNewsIntelligence {
  affectedEntities: string[];
  actionRequired: boolean;
  actionSummary: string | null;
  effectiveDate: string | null;
  deadlineDate: string | null;
  keyPrograms: string[];
  changeStatus: "new" | "revised";
  extractionConfidence: "low" | "medium" | "high";
}

const DATE = "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";
const EFFECTIVE_DATE_RE = new RegExp(`\\beffective(?:\\s+on|\\s+as\\s+of)?\\s+(${DATE})`, "i");
const DEADLINE_DATE_RE = new RegExp(`\\b(?:by|no later than|deadline(?:\\s+is)?|due(?:\\s+date)?(?:\\s+is)?)\\s+(${DATE})`, "i");
const ENTITY_PATTERN = "(?:providers?|managed care plans?|MCPs?|Federally Qualified Health Centers?|FQHCs?|rural health clinics?|RHCs?|pharmacies|laboratories|hospitals|billing providers?)";
const ACTION_RE = new RegExp(`\\b${ENTITY_PATTERN}\\b[^.!?]{0,120}\\b(?:must|shall|are required to|required to)\\b|^(?:please\\s+)?(?:submit|complete|implement|transition to|begin using)\\b`, "i");
const ENTITY_RE = new RegExp(`\\b${ENTITY_PATTERN}\\b`, "gi");
const PROGRAM_RE = /\b(?:Medi-?Cal Managed Care|Medi-Cal|Treatment Authorization Requests?|TARs?|Healthcare Common Procedure Coding System|HCPCS|Federally Qualified Health Centers?|FQHCs?|California Children's Services|CCS)\b/gi;

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function uniqueMatches(text: string, expression: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(expression)) found.add(match[0]);
  return [...found];
}

/** True only for an explicit later source revision; safe for future revised filters. */
export function isRecentlyRevised(revisedDate: Date | null, publishedDate: Date): boolean {
  return revisedDate !== null && revisedDate.getTime() > publishedDate.getTime();
}

export function deriveNewsIntelligence(input: NewsIntelligenceInput): DerivedNewsIntelligence {
  const text = plainText([input.title, input.summary, input.body ?? ""].filter(Boolean).join(". "));
  const sourceSentences = sentences(text);
  const actionSentence = sourceSentences.find((sentence) => ACTION_RE.test(sentence)) ?? null;
  const effectiveDate = text.match(EFFECTIVE_DATE_RE)?.[1] ?? null;
  const deadlineSentence = sourceSentences.find((sentence) => DEADLINE_DATE_RE.test(sentence)) ?? null;
  const deadlineDate = deadlineSentence?.match(DEADLINE_DATE_RE)?.[1] ?? null;
  const actionRequired = actionSentence !== null;
  const actionSummary = actionRequired ? actionSentence : null;
  const evidenceCount = [actionSummary, effectiveDate, deadlineDate].filter(Boolean).length;

  return {
    affectedEntities: actionRequired ? uniqueMatches(actionSentence!, ENTITY_RE) : [],
    actionRequired,
    actionSummary,
    effectiveDate,
    deadlineDate,
    keyPrograms: uniqueMatches(text, PROGRAM_RE),
    changeStatus: isRecentlyRevised(input.revisedDate, input.publishedDate) ? "revised" : "new",
    extractionConfidence: evidenceCount >= 2 ? "high" : evidenceCount === 1 ? "medium" : "low",
  };
}

export interface SearchableNewsItem {
  title: string;
  summary: string;
  body: string | null;
}

export interface TextRange { start: number; end: number; }
export interface SearchSnippet { text: string; ranges: TextRange[]; }
export interface NewsSearchResult<T extends SearchableNewsItem> {
  item: T;
  score: number;
  snippet: SearchSnippet;
}

const ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ["FQHC", "FQHCs", "Federally Qualified Health Center", "Federally Qualified Health Centers"],
  ["TAR", "TARs", "Treatment Authorization Request", "Treatment Authorization Requests"],
  ["HCPCS", "Healthcare Common Procedure Coding System"],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (ALIAS_GROUPS.some((group) => group.some((alias) => normalizedQuery === alias.toLowerCase()))) {
    return [query.trim()];
  }
  const phrases = [...query.matchAll(/"([^"\n]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const remainder = query.replace(/"[^"\n]+"/g, " ").trim();
  return [...phrases, ...remainder.split(/\s+/).filter(Boolean)];
}

function aliasesFor(term: string): string[] {
  const normalized = term.toLowerCase();
  const group = ALIAS_GROUPS.find((aliases) => aliases.some((alias) => alias.toLowerCase() === normalized));
  return group ? [...group] : [term];
}

function rangesFor(text: string, terms: string[]): TextRange[] {
  const ranges: TextRange[] = [];
  for (const term of terms) {
    for (const alias of aliasesFor(term)) {
      const expression = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
      for (const match of text.matchAll(expression)) ranges.push({ start: match.index!, end: match.index! + match[0].length });
    }
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end).filter((range, index, all) => index === 0 || range.start !== all[index - 1].start || range.end !== all[index - 1].end);
}

function snippetFor(text: string, ranges: TextRange[]): SearchSnippet {
  if (ranges.length === 0) return { text: text.slice(0, 240), ranges: [] };
  const start = Math.max(0, ranges[0].start - 80);
  const end = Math.min(text.length, Math.max(ranges[0].end + 160, start + 1));
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return {
    text: `${prefix}${text.slice(start, end)}${suffix}`,
    ranges: ranges.filter((range) => range.end > start && range.start < end).map((range) => ({ start: range.start - start + prefix.length, end: range.end - start + prefix.length })),
  };
}

/** Deterministic text-only search: title, then summary, then body. No HTML or external calls. */
export function searchNewsItems<T extends SearchableNewsItem>(items: T[], query: string): NewsSearchResult<T>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  return items.map((item) => {
    const fields = [plainText(item.title), plainText(item.summary), plainText(item.body ?? "")];
    const weights = [100, 10, 1];
    const fieldRanges = fields.map((field) => rangesFor(field, terms));
    const score = fieldRanges.reduce((total, ranges, index) => total + ranges.length * weights[index], 0);
    const hasEveryTerm = terms.every((term) => fields.some((field) => rangesFor(field, [term]).length > 0));
    const bestField = fieldRanges.findIndex((ranges) => ranges.length > 0);
    return { item, score: hasEveryTerm ? score : 0, snippet: snippetFor(fields[bestField < 0 ? 0 : bestField], fieldRanges[bestField < 0 ? 0 : bestField]) };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score);
}
