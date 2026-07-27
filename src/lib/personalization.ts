export type SavedView = "all" | "bookmarked";

export type FilterPreferences = {
  query: string;
  category: string;
  month: string;
  source: string;
  classification: string;
  hpFilter: string;
  view: SavedView;
};

export const defaultPreferences: FilterPreferences = {
  query: "",
  category: "all",
  month: "all",
  source: "all",
  classification: "all",
  hpFilter: "all",
  view: "all",
};

export type PersonalizationState = {
  version: 1;
  bookmarks: string[];
  read: string[];
  lastVisitedAt: string | null;
  preferences: FilterPreferences;
  aboutDismissed: boolean;
  installHintDismissed: boolean;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "medi-cal-intelligence:personalization";

function initialState(): PersonalizationState {
  return {
    version: 1,
    bookmarks: [],
    read: [],
    lastVisitedAt: null,
    preferences: { ...defaultPreferences },
    aboutDismissed: false,
    installHintDismissed: false,
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))] : [];
}

function normalize(value: unknown): PersonalizationState {
  if (!value || typeof value !== "object") return initialState();
  const state = value as Partial<PersonalizationState>;
  const preferences: Partial<FilterPreferences> = state.preferences && typeof state.preferences === "object" ? state.preferences : {};
  return {
    ...initialState(),
    bookmarks: strings(state.bookmarks),
    read: strings(state.read),
    lastVisitedAt: typeof state.lastVisitedAt === "string" ? state.lastVisitedAt : null,
    preferences: {
      query: typeof preferences.query === "string" ? preferences.query : defaultPreferences.query,
      category: typeof preferences.category === "string" ? preferences.category : defaultPreferences.category,
      month: typeof preferences.month === "string" ? preferences.month : defaultPreferences.month,
      source: ["all", "news", "bulletin", "alert", "public_notice"].includes(preferences.source ?? "") ? preferences.source! : defaultPreferences.source,
      classification: ["all", "regulatory", "informational"].includes(preferences.classification ?? "") ? preferences.classification! : defaultPreferences.classification,
      hpFilter: typeof preferences.hpFilter === "string" ? preferences.hpFilter : defaultPreferences.hpFilter,
      view: preferences.view === "bookmarked" ? "bookmarked" : "all",
    },
    aboutDismissed: state.aboutDismissed === true,
    installHintDismissed: state.installHintDismissed === true,
  };
}

export function createPersonalizationStore(storage?: StorageLike | null) {
  let state = initialState();
  try {
    state = normalize(storage?.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) : null);
  } catch {
    state = initialState();
  }

  const persist = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Local personalization remains available in memory if browser storage is blocked.
    }
  };

  const update = (next: PersonalizationState) => {
    state = next;
    persist();
  };

  return {
    read: () => state,
    toggleBookmark: (id: string) => update({ ...state, bookmarks: state.bookmarks.includes(id) ? state.bookmarks.filter((entry) => entry !== id) : [...state.bookmarks, id] }),
    markRead: (id: string) => update({ ...state, read: state.read.includes(id) ? state.read : [...state.read, id] }),
    savePreferences: (preferences: FilterPreferences) => update({ ...state, preferences: { ...preferences } }),
    setLastVisitedAt: (lastVisitedAt: string | null) => update({ ...state, lastVisitedAt }),
    recordVisit: (visitedAt: string) => update({ ...state, lastVisitedAt: visitedAt }),
    isNewSinceLastVisit: (postedAt: string) => Boolean(state.lastVisitedAt && new Date(postedAt).getTime() > new Date(state.lastVisitedAt).getTime()),
    dismissAbout: () => update({ ...state, aboutDismissed: true }),
    reopenAbout: () => update({ ...state, aboutDismissed: false }),
    dismissInstallHint: () => update({ ...state, installHintDismissed: true }),
  };
}

export function browserPersonalizationStore() {
  return createPersonalizationStore(typeof window === "undefined" ? null : window.localStorage);
}
