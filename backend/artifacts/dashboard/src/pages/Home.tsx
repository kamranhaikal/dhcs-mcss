import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { 
  useListNews, 
  useGetNewsMeta,
  getListNewsQueryKey,
  getGetNewsMetaQueryKey
} from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Download, 
  Rss, 
  FilterX,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  WrapText,
  ArrowUpDown,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ALL_COLUMNS = [
  { key: "title",      label: "Title" },
  { key: "summary",    label: "Summary" },
  { key: "body",       label: "Full Content" },
  { key: "source",     label: "Source" },
  { key: "type",       label: "Type" },
  { key: "categories", label: "DHCS Category" },
  { key: "hpMapping",  label: "HP Mapping" },
  { key: "status",     label: "Status" },
  { key: "period",     label: "Period" },
  { key: "postedAt",   label: "Time Posted" },
] as const;

const HP_CATEGORIES = [
  "Provider Operations",
  "Program & Policy Updates",
  "Special Populations",
  "Billing, Coding & Reimbursement",
  "General Reminders & Informational Notices",
  "Systems & Technology",
] as const;

const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  title: 150, summary: 180, body: 300, source: 100, type: 120,
  categories: 150, hpMapping: 185, status: 150, period: 95, postedAt: 150,
};

type ColKey = typeof ALL_COLUMNS[number]["key"];

function hpCategoryColor(cat: string): string {
  switch (cat) {
    case "Provider Operations":                       return "bg-sky-50 text-sky-700 border border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-600";
    case "Program & Policy Updates":                  return "bg-purple-50 text-purple-700 border border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-600";
    case "Special Populations":                       return "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-600";
    case "Billing, Coding & Reimbursement":           return "bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-600";
    case "General Reminders & Informational Notices": return "bg-slate-50 text-slate-600 border border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-600";
    case "Systems & Technology":                      return "bg-cyan-50 text-cyan-700 border border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-600";
    default:                                          return "bg-gray-50 text-gray-600 border border-gray-300";
  }
}

function stripHtml(html: string): string {
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

function parseHash(): { page: number; pageSize: number | "all" } {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "all") return { page: 1, pageSize: "all" };
  const m = hash.match(/^(\d+)-(\d+)$/);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    const size = end - start;
    if (size > 0) return { page: Math.floor(start / size) + 1, pageSize: size };
  }
  return { page: 1, pageSize: 25 };
}

function makeHash(page: number, pageSize: number | "all"): string {
  if (pageSize === "all") return "all";
  const start = (page - 1) * pageSize;
  return `${start}-${start + pageSize}`;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const [wrapText, setWrapText] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    new Set(ALL_COLUMNS.map(c => c.key))
  );
  const [page, setPage] = useState(() => parseHash().page);
  const [pageSize, setPageSize] = useState<number | "all">(() => parseHash().pageSize);
  const [postedAtSort, setPostedAtSort] = useState<"newest" | "oldest">("newest");
  const [hpFilter, setHpFilter] = useState("all");
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(DEFAULT_COL_WIDTHS);
  const resizingRef = useRef<{ col: ColKey; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { col, startX: e.clientX, startWidth: colWidths[col] };
    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
    };
    const onMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [colWidths]);

  const toggleBody = useCallback((link: string) => {
    setExpandedBodies(prev => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link); else next.add(link);
      return next;
    });
  }, []);

  const toggleSummary = useCallback((link: string) => {
    setExpandedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link); else next.add(link);
      return next;
    });
  }, []);

  const toggleCol = useCallback((key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); } else next.add(key);
      return next;
    });
  }, []);

  const visibleColCount = visibleCols.size;
  const col = (key: ColKey) => visibleCols.has(key);

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  
  const initialQ = searchParams.get("q") || "";
  const initialCategory = searchParams.get("category") || "all";
  const initialMonth = searchParams.get("month") || "all";
  const initialSource = searchParams.get("source") || "all";
  const initialClassification = searchParams.get("classification") || "all";

  const [qInput, setQInput] = useState(initialQ);
  const debouncedQ = useDebounce(qInput, 400);

  const updateFilters = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchString);
    Object.entries(updates).forEach(([key, val]) => {
      if (!val || val === "all") {
        newParams.delete(key);
      } else {
        newParams.set(key, val);
      }
    });
    setLocation(`/?${newParams.toString()}`);
  };

  const category = initialCategory;
  const month = initialMonth;
  const source = initialSource;
  const classification = initialClassification;

  // The actual query params we send to the API
  const apiParams = {
    q: debouncedQ || undefined,
    category: category !== "all" ? category : undefined,
    month: month !== "all" ? month : undefined,
    source: (source !== "all" ? source : undefined) as "news" | "bulletin" | "alert" | "public_notice" | undefined,
    classification: (classification !== "all" ? classification : undefined) as "informational" | "regulatory" | undefined,
  };

  const { data: metaData } = useGetNewsMeta({
    query: {
      queryKey: getGetNewsMetaQueryKey()
    }
  });

  const { data: newsData, isLoading, isError } = useListNews(apiParams, {
    query: {
      queryKey: getListNewsQueryKey(apiParams),
    }
  });

  const handleClearFilters = () => {
    setQInput("");
    setHpFilter("all");
    setLocation("/");
  };

  const hasActiveFilters = !!(debouncedQ || category !== "all" || month !== "all" || source !== "all" || classification !== "all" || hpFilter !== "all");

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedQ, category, month, source, classification, hpFilter]);

  const allItems = useMemo(() => {
    let items = newsData?.items ?? [];
    if (hpFilter !== "all") {
      items = items.filter(item => item.hpMappings?.includes(hpFilter));
    }
    return [...items].sort((a, b) => {
      const aTime = new Date(a.postedAt).getTime();
      const bTime = new Date(b.postedAt).getTime();
      return postedAtSort === "newest" ? bTime - aTime : aTime - bTime;
    });
  }, [newsData, postedAtSort, hpFilter]);
  const totalItems = allItems.length;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);

  // Keep URL hash in sync with current view: #0-25, #25-50, #all, etc.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const hash = makeHash(safePage, pageSize);
    if (window.location.hash.replace(/^#/, "") !== hash) {
      window.history.replaceState(null, "", `#${hash}`);
    }
  }, [safePage, pageSize]);
  const pagedItems = pageSize === "all"
    ? allItems
    : allItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  const startItem = totalItems === 0 ? 0 : (pageSize === "all" ? 1 : (safePage - 1) * pageSize + 1);
  const endItem = pageSize === "all" ? totalItems : Math.min(safePage * pageSize, totalItems);

  const handleCopyRSS = async () => {
    try {
      const rssUrl = `${window.location.origin}/api/rss.xml`;
      await navigator.clipboard.writeText(rssUrl);
      toast({
        title: "RSS Feed URL Copied",
        description: "Paste this into any RSS reader.",
      });
    } catch {
      toast({ title: "Failed to copy", description: "Please copy the link manually.", variant: "destructive" });
    }
  };

  const handleCopyJSON = async () => {
    try {
      const jsonUrl = `${window.location.origin}/api/feed.json?limit=200`;
      await navigator.clipboard.writeText(jsonUrl);
      toast({
        title: "JSON Feed URL Copied",
        description: "Use this URL in Office Scripts or Power Automate. Add &source=news, &source=bulletin, &source=alert, or &source=public_notice to filter, and change limit= as needed.",
      });
    } catch {
      toast({ title: "Failed to copy", description: "Please copy the link manually.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-muted/60 border-b border-border/50 px-6 lg:px-10 py-2.5 text-sm text-muted-foreground text-center">
        This is an aggregated feed of all the publications for DHCS MCSS found here:{" "}
        <a
          href="https://mcweb.apps.prd.cammis.medi-cal.ca.gov/publications"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          https://mcweb.apps.prd.cammis.medi-cal.ca.gov/publications
        </a>
      </div>
      <header className="border-b border-border/50 bg-card py-6 px-6 lg:px-10 shrink-0">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <span className="bg-primary text-primary-foreground p-1.5 rounded-md">
                <ChevronRight className="w-6 h-6" strokeWidth={3} />
              </span>
              Medi-Cal News Intelligence
            </h1>
            <p className="text-muted-foreground mt-2 text-sm font-medium">
              Official bulletins, provider updates, and program news — indexed and searchable.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hover-elevate">
                  <Rss className="w-4 h-4 mr-2" />
                  Feed URLs
                  <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-semibold">RSS Reader</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div
                  className="relative flex cursor-pointer select-none items-start gap-2 rounded-sm px-3 py-2.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={handleCopyRSS}
                >
                  <Rss className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
                  <div>
                    <p className="font-medium">Copy RSS URL</p>
                    <p className="text-xs text-muted-foreground mt-0.5">For Outlook, Feedly, or any RSS reader</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-semibold">Office Scripts / Power Automate</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div
                  className="relative flex cursor-pointer select-none items-start gap-2 rounded-sm px-3 py-2.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={handleCopyJSON}
                >
                  <Download className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
                  <div>
                    <p className="font-medium">Copy JSON Feed URL</p>
                    <p className="text-xs text-muted-foreground mt-0.5">200 most recent items — works with Office Scripts &amp; Power Automate</p>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" asChild className="hover-elevate">
              <a href="/api/export.xlsx" target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Download Excel
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full p-6 lg:px-10 py-8 flex flex-col gap-6">
        
        <div className="bg-card border border-border/50 rounded-lg p-4 shadow-sm flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by keyword in title or summary..." 
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                updateFilters({ q: e.target.value });
              }}
              className="pl-9 bg-background/50 border-input"
            />
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <div className="w-full sm:w-[220px]">
              <Select 
                value={category} 
                onValueChange={(val) => updateFilters({ category: val })}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="All DHCS Categories" />
                </SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">All DHCS Categories</SelectItem>
                  {metaData?.categories?.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-[200px]">
              <Select 
                value={month} 
                onValueChange={(val) => updateFilters({ month: val })}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {metaData?.months?.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-[160px]">
              <Select
                value={source}
                onValueChange={(val) => updateFilters({ source: val })}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="news">News Articles</SelectItem>
                  <SelectItem value="bulletin">Bulletins</SelectItem>
                  <SelectItem value="alert">System Status Alerts</SelectItem>
                  <SelectItem value="public_notice">DHCS Public Notices</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-[175px]">
              <Select
                value={classification}
                onValueChange={(val) => updateFilters({ classification: val })}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="regulatory">Regulatory</SelectItem>
                  <SelectItem value="informational">Informational</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-[230px]">
              <Select
                value={hpFilter}
                onValueChange={setHpFilter}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="All HP Mappings" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All HP Mappings</SelectItem>
                  {HP_CATEGORIES.map(hp => (
                    <SelectItem key={hp} value={hp}>{hp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                onClick={handleClearFilters}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <FilterX className="w-4 h-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col rounded-lg border border-border/50 bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border/50 bg-muted/20 flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {isLoading ? "Searching records…" : totalItems === 0 ? "No results" : (
                <>Showing {startItem}–{endItem} of {totalItems} result{totalItems !== 1 ? "s" : ""}</>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {/* Wrap text toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="wrap-text"
                  checked={wrapText}
                  onCheckedChange={setWrapText}
                  className="scale-90"
                />
                <Label htmlFor="wrap-text" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                  <WrapText className="w-3.5 h-3.5" />
                  Wrap text
                </Label>
              </div>

              <div className="w-px h-4 bg-border" />

              {/* Column visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Columns2 className="w-3.5 h-3.5" />
                    Columns
                    {visibleColCount < ALL_COLUMNS.length && (
                      <Badge variant="secondary" className="ml-0.5 text-[10px] px-1 py-0 h-4">
                        {visibleColCount}/{ALL_COLUMNS.length}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_COLUMNS.map(c => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      className="text-xs"
                      checked={visibleCols.has(c.key)}
                      onCheckedChange={() => toggleCol(c.key)}
                      disabled={visibleCols.has(c.key) && visibleColCount === 1}
                    >
                      {c.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="w-px h-4 bg-border" />

              {/* Rows per page */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(v === "all" ? "all" : Number(v))}
                >
                  <SelectTrigger className="h-8 w-[80px] text-xs bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map(n => (
                      <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                    ))}
                    <SelectItem value="all" className="text-xs">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            {isError ? (
              <div className="p-8">
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>Failed to load news records. Please try again later.</AlertDescription>
                </Alert>
              </div>
            ) : (
              <Table
                className="table-fixed w-full"
                style={{ minWidth: ALL_COLUMNS.filter(c => visibleCols.has(c.key)).reduce((s, c) => s + colWidths[c.key], 0) + "px" }}
              >
                <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur-sm">
                  <TableRow className="hover:bg-transparent">
                    {col("title") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.title }}>
                        <span className="block truncate pr-3">Title</span>
                        <div onMouseDown={(e) => startResize("title", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("summary") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.summary }}>
                        <span className="block truncate pr-3">Summary</span>
                        <div onMouseDown={(e) => startResize("summary", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("body") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.body }}>
                        <span className="block truncate pr-3">Full Content</span>
                        <div onMouseDown={(e) => startResize("body", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("source") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.source }}>
                        <span className="block truncate pr-3">Source</span>
                        <div onMouseDown={(e) => startResize("source", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("type") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.type }}>
                        <span className="block truncate pr-3">Type</span>
                        <div onMouseDown={(e) => startResize("type", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("categories") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.categories }}>
                        <span className="block truncate pr-3">DHCS Category</span>
                        <div onMouseDown={(e) => startResize("categories", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("hpMapping") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.hpMapping }}>
                        <span className="block truncate pr-3">HP Mapping</span>
                        <div onMouseDown={(e) => startResize("hpMapping", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("status") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden" style={{ width: colWidths.status }}>
                        <span className="block truncate pr-3">Status</span>
                        <div onMouseDown={(e) => startResize("status", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("period") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden text-right" style={{ width: colWidths.period }}>
                        <span className="block truncate pr-3">Period</span>
                        <div onMouseDown={(e) => startResize("period", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                    {col("postedAt") && (
                      <TableHead className="relative font-semibold select-none overflow-hidden text-right" style={{ width: colWidths.postedAt }}>
                        <button
                          onClick={() => setPostedAtSort(s => s === "newest" ? "oldest" : "newest")}
                          className="inline-flex items-center gap-1 hover:text-primary transition-colors pr-3"
                          title={postedAtSort === "newest" ? "Sorted newest first — click for oldest first" : "Sorted oldest first — click for newest first"}
                        >
                          Time Posted
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <div onMouseDown={(e) => startResize("postedAt", e)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-border/70 transition-colors" />
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !newsData ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {col("title")      && <TableCell><Skeleton className="h-5 w-full max-w-xs" /></TableCell>}
                        {col("summary")    && <TableCell><Skeleton className="h-10 w-full max-w-sm" /></TableCell>}
                        {col("body")       && <TableCell><Skeleton className="h-16 w-full" /></TableCell>}
                        {col("source")     && <TableCell><Skeleton className="h-5 w-20" /></TableCell>}
                        {col("type")       && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
                        {col("categories") && <TableCell><Skeleton className="h-6 w-24" /></TableCell>}
                        {col("hpMapping")  && <TableCell><Skeleton className="h-6 w-32" /></TableCell>}
                        {col("status")     && <TableCell><Skeleton className="h-5 w-32" /></TableCell>}
                        {col("period")     && <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>}
                        {col("postedAt")   && <TableCell><Skeleton className="h-5 w-28 ml-auto" /></TableCell>}
                      </TableRow>
                    ))
                  ) : newsData?.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="h-64 text-center">
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <FilterX className="w-8 h-8 mb-3 opacity-50" />
                          <p className="text-lg font-medium text-foreground">No records found</p>
                          <p className="text-sm">Try adjusting your filters or search terms.</p>
                          {hasActiveFilters && (
                            <Button variant="outline" className="mt-4" onClick={handleClearFilters}>
                              Clear all filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedItems.map((item, i) => {
                      const summaryText = item.summary || "";
                      const SUMMARY_LIMIT = 280;
                      const summaryTruncated = !wrapText && summaryText.length > SUMMARY_LIMIT;
                      const summaryExpanded = expandedSummaries.has(item.link);
                      const bodyText = stripHtml(item.body || "");
                      const BODY_LIMIT = 200;
                      const bodyTruncated = !wrapText && bodyText.length > BODY_LIMIT;
                      return (
                        <TableRow key={i} className="group hover:bg-muted/20 transition-colors">
                          {col("title") && (
                            <TableCell className="py-4 align-top">
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-primary hover:underline hover:text-primary/80 flex items-start gap-2 leading-snug"
                              >
                                <span>{item.title}</span>
                                <ExternalLink className="w-3.5 h-3.5 mt-1 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                              </a>
                            </TableCell>
                          )}
                          {col("summary") && (
                            <TableCell className="py-4 align-top">
                              {summaryText ? (
                                <div>
                                  <p className="text-sm text-muted-foreground leading-relaxed">
                                    {summaryTruncated && !summaryExpanded
                                      ? summaryText.slice(0, SUMMARY_LIMIT) + "…"
                                      : summaryText}
                                  </p>
                                  {summaryTruncated && (
                                    <button
                                      onClick={() => toggleSummary(item.link)}
                                      className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                    >
                                      {summaryExpanded
                                        ? <><ChevronUp className="w-3 h-3" />Show less</>
                                        : <><ChevronDown className="w-3 h-3" />Read more</>}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm italic text-muted-foreground opacity-50">—</span>
                              )}
                            </TableCell>
                          )}
                          {col("body") && (
                            <TableCell className="py-4 align-top">
                              {item.body ? (
                                <div>
                                  {!expandedBodies.has(item.link) ? (
                                    <>
                                      <p className="text-sm text-muted-foreground leading-relaxed">
                                        {bodyTruncated ? bodyText.slice(0, BODY_LIMIT) + "…" : bodyText}
                                      </p>
                                      {bodyTruncated && (
                                        <button
                                          onClick={() => toggleBody(item.link)}
                                          className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                        >
                                          <ChevronDown className="w-3 h-3" />
                                          Read more
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <div
                                        className="prose prose-sm max-w-none text-foreground [&_a]:text-primary [&_a]:underline [&_table]:text-xs [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1 [&_th]:border [&_th]:border-border [&_th]:p-1 [&_th]:bg-muted/40"
                                        dangerouslySetInnerHTML={{ __html: item.body }}
                                      />
                                      <button
                                        onClick={() => toggleBody(item.link)}
                                        className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                      >
                                        <ChevronUp className="w-3 h-3" />
                                        Show less
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm italic text-muted-foreground opacity-50">—</span>
                              )}
                            </TableCell>
                          )}
                          {col("source") && (
                            <TableCell className="py-4 align-top">
                              <Badge
                                variant="outline"
                                className={
                                  item.source === "bulletin"
                                    ? "text-xs font-semibold border-amber-400 text-amber-700 bg-amber-50 dark:border-amber-500 dark:text-amber-300 dark:bg-amber-950/40 whitespace-nowrap"
                                    : item.source === "alert"
                                    ? "text-xs font-semibold border-red-400 text-red-700 bg-red-50 dark:border-red-500 dark:text-red-300 dark:bg-red-950/40 whitespace-nowrap"
                                    : item.source === "public_notice"
                                    ? "text-xs font-semibold border-violet-400 text-violet-700 bg-violet-50 dark:border-violet-500 dark:text-violet-300 dark:bg-violet-950/40 whitespace-nowrap"
                                    : "text-xs font-semibold border-blue-400 text-blue-700 bg-blue-50 dark:border-blue-500 dark:text-blue-300 dark:bg-blue-950/40 whitespace-nowrap"
                                }
                              >
                                {item.source === "bulletin" ? "Bulletin" : item.source === "alert" ? "System Alert" : item.source === "public_notice" ? "DHCS Public Notice" : "News"}
                              </Badge>
                            </TableCell>
                          )}
                          {col("type") && (
                            <TableCell className="py-4 align-top">
                              <Badge
                                variant="outline"
                                className={
                                  item.classification === "regulatory"
                                    ? "text-xs font-semibold border-orange-400 text-orange-700 bg-orange-50 dark:border-orange-500 dark:text-orange-300 dark:bg-orange-950/40 whitespace-nowrap"
                                    : "text-xs font-semibold border-teal-400 text-teal-700 bg-teal-50 dark:border-teal-500 dark:text-teal-300 dark:bg-teal-950/40 whitespace-nowrap"
                                }
                              >
                                {item.classification === "regulatory" ? "Regulatory" : "Informational"}
                              </Badge>
                            </TableCell>
                          )}
                          {col("categories") && (
                            <TableCell className="py-4 align-top overflow-hidden">
                              <div className="flex flex-wrap gap-1.5">
                                {item.categories.map((cat, ci) => (
                                  <Badge key={ci} variant="secondary" className="font-medium bg-secondary/50 hover:bg-secondary border-none text-xs">
                                    {cat}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          )}
                          {col("hpMapping") && (
                            <TableCell className="py-4 align-top overflow-hidden">
                              <div className="flex flex-wrap gap-1.5">
                                {(item.hpMappings ?? []).map((hp, hi) => (
                                  <span key={hi} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${hpCategoryColor(hp)}`}>
                                    {hp}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                          )}
                          {col("status") && (
                            <TableCell className="py-4 align-top">
                              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                                {item.publishedLabel}
                              </span>
                            </TableCell>
                          )}
                          {col("period") && (
                            <TableCell className="py-4 align-top text-right">
                              <span className="text-sm font-medium bg-muted px-2.5 py-1 rounded-md text-foreground">
                                {item.monthYear}
                              </span>
                            </TableCell>
                          )}
                          {col("postedAt") && (
                            <TableCell className="py-4 align-top text-right">
                              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                                {new Date(item.postedAt).toLocaleString("en-US", {
                                  month: "numeric",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Pagination footer */}
          {!isLoading && totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border/50 bg-muted/20 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(1)}
                  disabled={safePage === 1}
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline" size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                {/* Page number buttons — show up to 7 around current page */}
                {(() => {
                  const delta = 3;
                  const range: number[] = [];
                  for (let i = Math.max(1, safePage - delta); i <= Math.min(totalPages, safePage + delta); i++) {
                    range.push(i);
                  }
                  return range.map(n => (
                    <Button
                      key={n}
                      variant={n === safePage ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </Button>
                  ));
                })()}

                <Button
                  variant="outline" size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline" size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(totalPages)}
                  disabled={safePage === totalPages}
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
