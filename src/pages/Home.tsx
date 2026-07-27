import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  useGetNewsMeta,
  useGetNewsItem,
  getListNewsQueryKey,
  listNews,
  type NewsItem,
} from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { buildSubscriptionUrl, flattenNewsPages, stableItemId } from "@/lib/news-feed";
import { browserPersonalizationStore, type FilterPreferences } from "@/lib/personalization";
import {
  PiArrowClockwise,
  PiArrowSquareOut,
  PiBell,
  PiBookmark,
  PiBookmarkSimple,
  PiCaretDown,
  PiCaretRight,
  PiCheck,
  PiDeviceMobile,
  PiDownloadSimple,
  PiFunnel,
  PiFunnelX,
  PiMagnifyingGlass,
  PiMoon,
  PiNewspaperClipping,
  PiRss,
  PiShareNetwork,
  PiSlidersHorizontal,
  PiSun,
  PiX,
} from "react-icons/pi";

const HP_CATEGORIES = [
  "Provider Operations",
  "Program & Policy Updates",
  "Special Populations",
  "Billing, Coding & Reimbursement",
  "General Reminders & Informational Notices",
  "Systems & Technology",
] as const;

const SOURCE_OPTIONS = [
  { value: "all", label: "All updates" },
  { value: "news", label: "News" },
  { value: "bulletin", label: "Bulletins" },
  { value: "alert", label: "Alerts" },
  { value: "public_notice", label: "Notices" },
] as const;

type SourceValue = (typeof SOURCE_OPTIONS)[number]["value"];

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Theme = "light" | "dark";

function stripHtml(value: string): string {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function sourceLabel(source: NewsItem["source"]): string {
  if (source === "bulletin") return "Bulletin";
  if (source === "alert") return "System alert";
  if (source === "public_notice") return "Public notice";
  return "News";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}


function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="filter-field" htmlFor={id}>
      <span>{label}</span>
      <span className="select-shell">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <PiCaretDown aria-hidden="true" />
      </span>
    </label>
  );
}

function SourceMark({ source }: { source: NewsItem["source"] }) {
  if (source === "alert") return <PiBell aria-hidden="true" />;
  if (source === "bulletin") return <PiRss aria-hidden="true" />;
  return <PiNewspaperClipping aria-hidden="true" />;
}

function DetailContent({
  item,
  onShare,
  isBookmarked,
  onToggleBookmark,
  isLoadingFullItem,
}: {
  item: NewsItem;
  onShare: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  isLoadingFullItem: boolean;
}) {
  const body = stripHtml(item.body || "");

  return (
    <article className="detail-content">
      <div className="detail-kicker">
        <span className={`source-badge source-${item.source}`}>
          <SourceMark source={item.source} />
          {sourceLabel(item.source)}
        </span>
        <span>{formatDate(item.postedAt)}</span>
      </div>

      <h2>{item.title}</h2>
      <p className="detail-summary">{item.summary}</p>

      <div className="detail-actions">
        <a className="primary-action" href={item.link} target="_blank" rel="noreferrer">
          Read original
          <PiArrowSquareOut aria-hidden="true" />
        </a>
        <button className="secondary-action" type="button" onClick={onShare}>
          <PiShareNetwork aria-hidden="true" />
          Share
        </button>
        <button className={`secondary-action bookmark-action ${isBookmarked ? "is-bookmarked" : ""}`} type="button" onClick={onToggleBookmark} aria-pressed={isBookmarked}>
          {isBookmarked ? <PiBookmarkSimple aria-hidden="true" /> : <PiBookmark aria-hidden="true" />}
          {isBookmarked ? "Bookmarked" : "Bookmark"}
        </button>
      </div>

      <dl className="detail-facts">
        <div>
          <dt>Published</dt>
          <dd>{item.publishedLabel}</dd>
        </div>
        <div>
          <dt>Classification</dt>
          <dd>{item.classification === "regulatory" ? "Regulatory" : "Informational"}</dd>
        </div>
        <div>
          <dt>Posted</dt>
          <dd>{formatDateTime(item.postedAt)}</dd>
        </div>
        <div>
          <dt>Update status</dt>
          <dd>{item.changeStatus === "revised" ? "Revised" : item.changeStatus === "new" ? "New" : "Not available from this legacy record"}</dd>
        </div>
        <div>
          <dt>Action required</dt>
          <dd>{item.actionRequired === true ? "Yes — inferred from explicit source language" : item.actionRequired === false ? "No explicit action language extracted" : "Not available from this legacy record"}</dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>{item.effectiveDate === undefined ? "Not available from this legacy record" : item.effectiveDate || "No explicit effective-date cue extracted"}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{item.deadlineDate === undefined ? "Not available from this legacy record" : item.deadlineDate || "No explicit deadline cue extracted"}</dd>
        </div>
        <div>
          <dt>Inference confidence</dt>
          <dd>{item.extractionConfidence ? `${item.extractionConfidence} — deterministic source-bounded extraction` : "Not available from this legacy record"}</dd>
        </div>
        <div>
          <dt>Inference provenance</dt>
          <dd>Working aid derived from explicit source wording; not a DHCS determination.</dd>
        </div>
      </dl>

      <section className="detail-intelligence" aria-labelledby="detail-intelligence-heading">
        <h3 id="detail-intelligence-heading">Operational intelligence</h3>
        <div>
          <h4>Literal action summary</h4>
          <p>{item.actionSummary === undefined ? "Not available from this legacy record." : item.actionSummary || "No literal action sentence was extracted from the source."}</p>
        </div>
        <div>
          <h4>Affected entities</h4>
          <p>{item.affectedEntities === undefined ? "Not available from this legacy record." : item.affectedEntities.length ? item.affectedEntities.join(", ") : "No affected entities were extracted from explicit source wording."}</p>
        </div>
        <div>
          <h4>Programs and coding terms</h4>
          <p>{item.keyPrograms === undefined ? "Not available from this legacy record." : item.keyPrograms.length ? item.keyPrograms.join(", ") : "No program or coding terms were extracted from explicit source wording."}</p>
        </div>
      </section>

      {isLoadingFullItem && <p className="detail-loading" role="status">Loading the complete source record…</p>}

      {body && (
        <section className="detail-body" aria-labelledby="detail-body-heading">
          <h3 id="detail-body-heading">Full update</h3>
          <p>{body}</p>
        </section>
      )}

      {(item.categories.length > 0 || item.hpMappings.length > 0) && (
        <section className="detail-tags" aria-labelledby="detail-tags-heading">
          <h3 id="detail-tags-heading">Topics</h3>
          <div>
            {[...item.categories, ...item.hpMappings].map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const [personalizationStore] = useState(() => browserPersonalizationStore());
  const [personalization, setPersonalization] = useState(() => personalizationStore.read());
  const [visitBaseline] = useState(() => personalizationStore.read().lastVisitedAt);

  const [queryInput, setQueryInput] = useState(params.get("q") ?? personalization.preferences.query);
  const query = useDebounce(queryInput, 300);
  const category = params.get("category") ?? personalization.preferences.category;
  const month = params.get("month") ?? personalization.preferences.month;
  const source = (params.get("source") ?? personalization.preferences.source) as SourceValue;
  const classification = (params.get("classification") ?? personalization.preferences.classification) as "all" | "regulatory" | "informational";
  const view = params.get("view") === "bookmarked" ? "bookmarked" : personalization.preferences.view;
  const [hpFilter, setHpFilter] = useState(params.get("hpMapping") ?? personalization.preferences.hpFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [notice, setNotice] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [feedMenuOpen, setFeedMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("mci-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchString);
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
      }
      const serialized = next.toString();
      setLocation(serialized ? `/?${serialized}` : "/");
    },
    [searchString, setLocation],
  );

  useEffect(() => {
    updateParams({ q: query || null });
  }, [query]);

  useEffect(() => {
    const preferences: FilterPreferences = { query, category, month, source, classification, hpFilter, view };
    personalizationStore.savePreferences(preferences);
    setPersonalization(personalizationStore.read());
  }, [query, category, month, source, classification, hpFilter, view, personalizationStore]);


  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0d1015" : "#f5f7fa");
    window.localStorage.setItem("mci-theme", theme);
  }, [theme]);

  useEffect(() => {
    const overlayOpen = filterOpen || detailOpen || aboutOpen;
    if (overlayOpen) document.body.classList.add("overlay-open");
    else document.body.classList.remove("overlay-open");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      setDetailOpen(false);
      setAboutOpen(false);
      setFeedMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("overlay-open");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen, detailOpen, aboutOpen]);

  const apiParams = {
    q: query || undefined,
    category: category !== "all" ? category : undefined,
    month: month !== "all" ? month : undefined,
    source: source !== "all" ? source : undefined,
    classification: classification !== "all" ? classification : undefined,
    hpMapping: hpFilter !== "all" ? hpFilter : undefined,
  } as const;

  const { data: metaData } = useGetNewsMeta();
  const {
    data: newsPages,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: getListNewsQueryKey({ ...apiParams, limit: 25, includeBody: false }),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listNews({ ...apiParams, limit: 25, offset: pageParam, includeBody: false }, { signal }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? (lastPage.offset ?? 0) + (lastPage.limit ?? 25) : undefined,
  });
  const selectedId = selected?.id || "";
  const { data: fullSelectedItem, isFetching: isFetchingFullItem } = useGetNewsItem(selectedId);
  const selectedDetail = fullSelectedItem && selected && stableItemId(fullSelectedItem) === stableItemId(selected) ? fullSelectedItem : selected;

  const allItems = useMemo(() => {
    const items = flattenNewsPages(newsPages?.pages);
    const viewFiltered = view === "bookmarked"
      ? items.filter((item) => personalization.bookmarks.includes(stableItemId(item)))
      : items;
    return viewFiltered.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }, [newsPages?.pages, view, personalization.bookmarks]);

  const visibleItems = allItems;
  const loadedItems = flattenNewsPages(newsPages?.pages);
  const totalItems = newsPages?.pages[0]?.total ?? loadedItems.length;
  const alertCount = loadedItems.filter((item) => item.source === "alert").length;
  const latestSourcePost = loadedItems.reduce<string | null>((latest, item) => !latest || new Date(item.postedAt) > new Date(latest) ? item.postedAt : latest, null);
  const sourceSummary = SOURCE_OPTIONS.filter((option) => option.value !== "all")
    .map((option) => ({ label: option.label, count: loadedItems.filter((item) => item.source === option.value).length }))
    .filter((entry) => entry.count > 0);
  const activeFilterCount = [category, month, source, classification, hpFilter]
    .filter((value) => value !== "all").length;

  useEffect(() => {
    if (allItems.length === 0) {
      if (selected) setSelected(null);
      return;
    }
    const stillVisible = selected && allItems.some((item) => stableItemId(item) === stableItemId(selected));
    if (!stillVisible) setSelected(allItems[0]);
  }, [allItems, selected]);

  useEffect(() => {
    if (!newsPages) return;
    personalizationStore.recordVisit(new Date().toISOString());
    setPersonalization(personalizationStore.read());
  }, [newsPages, personalizationStore]);

  const clearFilters = () => {
    setQueryInput("");
    setHpFilter("all");
    setLocation("/");
  };

  const selectItem = (item: NewsItem) => {
    personalizationStore.markRead(stableItemId(item));
    setPersonalization(personalizationStore.read());
    setSelected(item);
    if (window.matchMedia("(max-width: 1179px)").matches) setDetailOpen(true);
  };

  const toggleBookmark = (item: NewsItem) => {
    personalizationStore.toggleBookmark(stableItemId(item));
    setPersonalization(personalizationStore.read());
  };

  const shareSelected = async () => {
    if (!selected) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: selected.title, text: selected.summary, url: selected.link });
      } else {
        await navigator.clipboard.writeText(selected.link);
        setNotice("Link copied");
        window.setTimeout(() => setNotice(""), 1800);
      }
    } catch {
      // Native share can be dismissed without requiring an error state.
    }
  };

  const subscriptionFilters = apiParams;
  const copyFeedUrl = async (path: string, label: string) => {
    const url = new URL(buildSubscriptionUrl(path, subscriptionFilters), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`${label} URL for the current filtered view copied`);
    } catch {
      setNotice(`Copy this URL: ${url}`);
    }
    window.setTimeout(() => setNotice(""), 2400);
  };

  const copyFeed = async (path: string, label: string) => {
    setFeedMenuOpen(false);
    await copyFeedUrl(path, label);
  };

  const feedMenuContent = (
    <div className="feed-menu" role="menu" aria-label="Subscribe to feeds">
      <div className="feed-menu-group">
        <p className="feed-menu-heading">RSS Reader</p>
        <button type="button" className="feed-menu-item" role="menuitem" onClick={() => copyFeed("/api/rss.xml", "RSS feed")}>
          <PiRss aria-hidden="true" className="feed-menu-icon feed-menu-icon-rss" />
          <span className="feed-menu-text">
            <strong>Copy RSS URL</strong>
            <span>For Outlook, Feedly, or any RSS reader</span>
          </span>
        </button>
      </div>
      <div className="feed-menu-group">
        <p className="feed-menu-heading">Office Scripts / Power Automate</p>
        <button type="button" className="feed-menu-item" role="menuitem" onClick={() => copyFeed("/api/feed.json", "JSON feed")}>
          <PiDownloadSimple aria-hidden="true" className="feed-menu-icon feed-menu-icon-json" />
          <span className="feed-menu-text">
            <strong>Copy JSON Feed URL</strong>
            <span>200 most recent items — works with Office Scripts &amp; Power Automate</span>
          </span>
        </button>
      </div>
    </div>
  );

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    personalizationStore.dismissInstallHint();
    setPersonalization(personalizationStore.read());
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#updates">Skip to updates</a>

      <header className={`app-header ${feedMenuOpen ? "is-feed-open" : ""}`}>
        <div className="header-inner">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">MC</span>
            <div>
              <strong>Medi-Cal Intelligence</strong>
              <span>Independent monitor of official DHCS publications</span>
            </div>
          </div>

          <div className="header-actions">
            <button className="header-button about-trigger" type="button" onClick={() => setAboutOpen(true)} aria-expanded={aboutOpen} aria-controls="about-monitor">
              About
            </button>
            <div className="feed-anchor desktop-only">
              <button className="header-button" type="button" onClick={() => setFeedMenuOpen(true)} aria-haspopup="menu" aria-expanded={feedMenuOpen} title="Subscribe via RSS or JSON feed">
                <PiRss aria-hidden="true" /> RSS
              </button>
              {feedMenuOpen && <div className="feed-pop feed-pop-desktop">{feedMenuContent}</div>}
            </div>
            {installPrompt && (
              <button className="header-button install-button" type="button" onClick={installApp}>
                <PiDeviceMobile aria-hidden="true" />
                <span>Install app</span>
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              onClick={() => refetch()}
              aria-label="Refresh updates"
              title="Refresh updates"
            >
              <PiArrowClockwise className={isFetching ? "is-spinning" : ""} aria-hidden="true" />
            </button>
            <button
              className="icon-button desktop-only"
              type="button"
              onClick={() => updateParams({ view: "bookmarked" })}
              aria-label="View bookmarks"
              title="View bookmarks"
            >
              <PiBookmarkSimple aria-hidden="true" />
            </button>
            <a className="icon-button desktop-only" href="/api/export.xlsx" aria-label="Download Excel" title="Download Excel">
              <PiDownloadSimple aria-hidden="true" />
            </a>
            <button
              className="icon-button"
              type="button"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <PiSun aria-hidden="true" /> : <PiMoon aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {aboutOpen && (
        <div className="about-modal-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) setAboutOpen(false); }}>
          <section className="about-modal" id="about-monitor" role="dialog" aria-modal="true" aria-labelledby="about-monitor-title">
            <div className="about-modal-head">
              <div>
                <p className="eyebrow">How it works</p>
                <h2 id="about-monitor-title">A focused working view of official DHCS publications.</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAboutOpen(false)} aria-label="Close how it works" autoFocus>
                <PiX aria-hidden="true" />
              </button>
            </div>
            <p className="about-modal-intro">Built for Medi-Cal operations, policy, compliance, and health-plan teams. This independent monitor is not an official DHCS service.</p>
            <div className="about-grid">
              <p><strong>Four source types</strong><span>DHCS news, bulletins, public notices, and system alerts.</span></p>
              <p><strong>Update cadence</strong><span>Results refresh when the app fetches the publication feed. Use Refresh for a new client request.</span></p>
              <p><strong>What is official</strong><span>Titles, dates, summaries, and links come from loaded official-source records.</span></p>
              <p><strong>What is inferred</strong><span>Classification, impact, and health-plan mappings are working aids—not DHCS determinations. Verify decisions in the source.</span></p>
            </div>
            <p className="about-modal-note">Preferences, read state, and bookmarks stay only in this browser.</p>
          </section>
        </div>
      )}

      {feedMenuOpen && <div className="feed-catch" onClick={() => setFeedMenuOpen(false)} aria-hidden="true" />}
      {feedMenuOpen && <div className="feed-pop feed-pop-mobile">{feedMenuContent}</div>}

      <main className="app-main">
        <section className="workspace-intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Independent monitor of official DHCS publications</p>
            <h1 id="page-title">Find the update that changes your work.</h1>
            <p>Search official Medi-Cal news, bulletins, public notices, and system alerts in one focused feed.</p>
          </div>
        </section>

        <section className="search-panel" aria-label="Search publications">
          <div className="search-field">
            <PiMagnifyingGlass aria-hidden="true" />
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search publications"
              aria-label="Search titles, summaries, and full publication text"
            />
            {queryInput && (
              <button type="button" onClick={() => setQueryInput("")} aria-label="Clear search">
                <PiX aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            className="filter-button"
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-expanded={filterOpen}
            aria-controls="filter-drawer"
          >
            <PiSlidersHorizontal aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>
        </section>

        <nav className="source-tabs" aria-label="Publication type and saved view">
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={source === option.value && view !== "bookmarked" ? "is-active" : ""}
              type="button"
              onClick={() => updateParams({ source: option.value, view: null })}
              aria-current={source === option.value && view !== "bookmarked" ? "page" : undefined}
            >
              {option.label}
            </button>
          ))}
          <button className={view === "bookmarked" ? "is-active" : ""} type="button" onClick={() => updateParams({ view: "bookmarked" })} aria-current={view === "bookmarked" ? "page" : undefined}>
            <PiBookmarkSimple aria-hidden="true" /> Bookmarked <span className="tab-count">{personalization.bookmarks.length}</span>
          </button>
        </nav>

        <div className="workspace-grid">
          <aside className="filter-rail" aria-label="Publication filters">
            <div className="filter-rail-head">
              <span><PiFunnel aria-hidden="true" /> Refine</span>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters}>Clear</button>
              )}
            </div>
            <FilterSelect id="rail-category" label="DHCS category" value={category} onChange={(value) => updateParams({ category: value })}>
              <option value="all">All categories</option>
              {metaData?.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect id="rail-month" label="Published" value={month} onChange={(value) => updateParams({ month: value })}>
              <option value="all">Any month</option>
              {metaData?.months.map((value) => <option key={value} value={value}>{value}</option>)}
            </FilterSelect>
            <FilterSelect id="rail-classification" label="Classification" value={classification} onChange={(value) => updateParams({ classification: value })}>
              <option value="all">All classifications</option>
              <option value="regulatory">Regulatory</option>
              <option value="informational">Informational</option>
            </FilterSelect>
            <FilterSelect id="rail-hp" label="Health plan mapping" value={hpFilter} onChange={(value) => { setHpFilter(value); updateParams({ hpMapping: value }); }}>
              <option value="all">All mappings</option>
              {HP_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </FilterSelect>
          </aside>

          <section className="feed-column" id="updates" aria-labelledby="updates-heading">
            <div className="feed-heading">
              <div>
                <h2 id="updates-heading">{view === "bookmarked" ? "Bookmarked updates" : "Latest updates"}</h2>
                <p>{isLoading ? "Loading publications" : `${allItems.length.toLocaleString()} of ${totalItems.toLocaleString()} matching publications loaded${visitBaseline ? ` · ${allItems.filter((item) => new Date(item.postedAt) > new Date(visitBaseline)).length} new since your last visit` : ""}`}</p>
              </div>
              <div className="feed-heading-actions">
                {alertCount > 0 && (
                  <button className="alert-affordance" type="button" onClick={() => updateParams({ source: "alert", view: null })}>
                    <PiBell aria-hidden="true" /> {alertCount} alert {alertCount === 1 ? "publication" : "publications"}
                  </button>
                )}
                {activeFilterCount > 0 && (
                  <button className="clear-inline" type="button" onClick={clearFilters}>
                    <PiFunnelX aria-hidden="true" />
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {!isLoading && !isError && loadedItems.length > 0 && (
              <aside className="freshness-panel" aria-label="Freshness and provenance">
                <span><strong>Loaded in this browser:</strong> {dataUpdatedAt ? formatDateTime(new Date(dataUpdatedAt).toISOString()) : "Loading"}</span>
                {latestSourcePost && <span><strong>Latest source-posted record:</strong> {formatDateTime(latestSourcePost)}</span>}
                <span><strong>Loaded types:</strong> {sourceSummary.map((entry) => `${entry.label} (${entry.count})`).join(", ")}</span>
                {alertCount > 0 && <span>Alert publication status may require opening the official link.</span>}
              </aside>
            )}

            {view === "bookmarked" && (
              <p className="bookmarks-explainer">Bookmarks are stored only in this browser. Subscription URLs copy the current server filters, not this local saved view.</p>
            )}

            {isError && (
              <div className="state-panel" role="alert">
                <PiBell aria-hidden="true" />
                <h3>Updates could not load</h3>
                <p>Check your connection and try again.</p>
                <button type="button" onClick={() => refetch()}>Try again</button>
              </div>
            )}

            {isLoading && !newsPages && (
              <div className="feed-skeleton" aria-label="Loading updates">
                {Array.from({ length: 6 }).map((_, index) => <span key={index} />)}
              </div>
            )}

            {!isLoading && !isError && visibleItems.length === 0 && (
              <div className="state-panel">
                <PiMagnifyingGlass aria-hidden="true" />
                <h3>No matching publications</h3>
                <p>Try a broader search or remove a filter.</p>
                <button type="button" onClick={clearFilters}>Clear all filters</button>
              </div>
            )}

            <div className="feed-list">
              {visibleItems.map((item) => {
                const itemKey = stableItemId(item);
                const isSelected = selected ? stableItemId(selected) === itemKey : false;
                const isBookmarked = personalization.bookmarks.includes(itemKey);
                const isUnread = !personalization.read.includes(itemKey);
                const isNew = Boolean(visitBaseline && new Date(item.postedAt) > new Date(visitBaseline));
                return (
                  <article className={`feed-card ${isSelected ? "is-selected" : ""} ${isUnread ? "is-unread" : ""}`} key={itemKey}>
                    <button type="button" className="feed-card-open" onClick={() => selectItem(item)} aria-label={`Open ${item.title}`}>
                      <span className={`feed-icon source-${item.source}`}>
                        <SourceMark source={item.source} />
                      </span>
                      <span className="feed-card-body">
                        <span className="feed-meta">
                          <span>{sourceLabel(item.source)}</span>
                          <time dateTime={item.postedAt}>{formatDate(item.postedAt)}</time>
                        </span>
                        <strong>{item.title}</strong>
                        <span className="feed-summary">{item.summary}</span>
                        <span className="feed-tags">
                          {isUnread && <span className="tag-unread">Unread</span>}
                          {isNew && <span className="tag-new">New since last visit</span>}
                          {item.changeStatus === "revised" && <span className="tag-revised">Revised</span>}
                          {item.actionRequired && <span className="tag-action">Action</span>}
                          {item.deadlineDate && <span className="tag-deadline">Deadline</span>}
                          {item.classification === "regulatory" && <span className="tag-regulatory">Regulatory</span>}
                          {item.categories.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                          {item.categories.length > 2 && <span>+{item.categories.length - 2}</span>}
                        </span>
                      </span>
                      <PiCaretRight className="feed-caret" aria-hidden="true" />
                    </button>
                    <button className={`bookmark-button ${isBookmarked ? "is-bookmarked" : ""}`} type="button" onClick={() => toggleBookmark(item)} aria-label={`${isBookmarked ? "Remove" : "Add"} bookmark for ${item.title}`} aria-pressed={isBookmarked}>
                      {isBookmarked ? <PiBookmarkSimple aria-hidden="true" /> : <PiBookmark aria-hidden="true" />}
                      <span>{isBookmarked ? "Bookmarked" : "Bookmark"}</span>
                    </button>
                  </article>
                );
              })}
            </div>

            {hasNextPage && (
              <button className="load-more" type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading more…" : "Load 25 more"}
                <span>{allItems.length} of {totalItems} loaded</span>
              </button>
            )}
          </section>

          <aside className="detail-panel" aria-label="Selected publication">
            {selectedDetail ? (
              <DetailContent item={selectedDetail} onShare={shareSelected} isBookmarked={personalization.bookmarks.includes(stableItemId(selectedDetail))} onToggleBookmark={() => toggleBookmark(selectedDetail)} isLoadingFullItem={isFetchingFullItem} />
            ) : (
              <div className="detail-empty">
                <PiNewspaperClipping aria-hidden="true" />
                <p>Select an update to read it here.</p>
              </div>
            )}
          </aside>
        </div>

        <footer className="provenance-footer">
          <strong>Independent monitor of official DHCS publications.</strong> Source-linked content should be verified at the direct official URL. Classification and health-plan mappings are inferred working labels, not official determinations.
        </footer>
      </main>

      <div className={`overlay-scrim ${filterOpen || detailOpen ? "is-open" : ""}`} onClick={() => { setFilterOpen(false); setDetailOpen(false); }} />

      <aside
        id="filter-drawer"
        className={`mobile-drawer ${filterOpen ? "is-open" : ""}`}
        aria-hidden={!filterOpen}
        aria-label="Filter publications"
      >
        <div className="drawer-handle" aria-hidden="true" />
        <div className="drawer-head">
          <div>
            <h2>Filter updates</h2>
            <p>Changes apply immediately</p>
          </div>
          <button type="button" onClick={() => setFilterOpen(false)} aria-label="Close filters"><PiX aria-hidden="true" /></button>
        </div>
        <div className="drawer-fields">
          <FilterSelect id="drawer-category" label="DHCS category" value={category} onChange={(value) => updateParams({ category: value })}>
            <option value="all">All categories</option>
            {metaData?.categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect id="drawer-month" label="Published" value={month} onChange={(value) => updateParams({ month: value })}>
            <option value="all">Any month</option>
            {metaData?.months.map((value) => <option key={value} value={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect id="drawer-classification" label="Classification" value={classification} onChange={(value) => updateParams({ classification: value })}>
            <option value="all">All classifications</option>
            <option value="regulatory">Regulatory</option>
            <option value="informational">Informational</option>
          </FilterSelect>
          <FilterSelect id="drawer-hp" label="Health plan mapping" value={hpFilter} onChange={(value) => { setHpFilter(value); updateParams({ hpMapping: value }); }}>
            <option value="all">All mappings</option>
            {HP_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </FilterSelect>
        </div>
        <div className="drawer-actions">
          {activeFilterCount > 0 && <button className="secondary-action" type="button" onClick={clearFilters}>Clear all</button>}
          <button className="primary-action" type="button" onClick={() => setFilterOpen(false)}>
            <PiCheck aria-hidden="true" />
            Show {allItems.length} loaded updates
          </button>
        </div>
      </aside>

      <aside className={`mobile-detail ${detailOpen ? "is-open" : ""}`} aria-hidden={!detailOpen} aria-label="Publication details">
        <div className="mobile-detail-head">
          <button type="button" onClick={() => setDetailOpen(false)} aria-label="Close publication"><PiX aria-hidden="true" /></button>
          <span>Publication</span>
          {selectedDetail ? <a href={selectedDetail.link} target="_blank" rel="noreferrer" aria-label="Open original"><PiArrowSquareOut aria-hidden="true" /></a> : <span />}
        </div>
        {selectedDetail && <DetailContent item={selectedDetail} onShare={shareSelected} isBookmarked={personalization.bookmarks.includes(stableItemId(selectedDetail))} onToggleBookmark={() => toggleBookmark(selectedDetail)} isLoadingFullItem={isFetchingFullItem} />}
      </aside>

      <nav className="mobile-action-bar" aria-label="Quick actions">
        <button type="button" onClick={() => setFilterOpen(true)}>
          <PiSlidersHorizontal aria-hidden="true" />
          <span>Filters</span>
          {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
        <button type="button" onClick={() => updateParams({ view: "bookmarked" })}>
          <PiBookmarkSimple aria-hidden="true" />
          <span>Saved</span>
        </button>
        <button type="button" onClick={() => setFeedMenuOpen(true)} aria-haspopup="menu" aria-expanded={feedMenuOpen}>
          <PiRss aria-hidden="true" />
          <span>RSS</span>
        </button>
        <a href="/api/export.xlsx">
          <PiDownloadSimple aria-hidden="true" />
          <span>Export</span>
        </a>
      </nav>

      {notice && <div className="toast-notice" role="status">{notice}</div>}
    </div>
  );
}
