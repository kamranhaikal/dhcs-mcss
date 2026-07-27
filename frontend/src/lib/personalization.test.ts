import { describe, expect, it } from "vitest";
import {
  createPersonalizationStore,
  defaultPreferences,
  type StorageLike,
} from "./personalization";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("personalization storage", () => {
  it("starts safely when saved state is corrupt", () => {
    const store = createPersonalizationStore(memoryStorage({ "medi-cal-intelligence:personalization": "not-json" }));

    expect(store.read()).toEqual({
      version: 1,
      bookmarks: [],
      read: [],
      lastVisitedAt: null,
      preferences: defaultPreferences,
      aboutDismissed: false,
      installHintDismissed: false,
    });
  });

  it("degrades to in-memory state when storage is blocked", () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const store = createPersonalizationStore(blocked);

    store.toggleBookmark("official-item-1");
    store.markRead("official-item-1");

    expect(store.read().bookmarks).toEqual(["official-item-1"]);
    expect(store.read().read).toEqual(["official-item-1"]);
  });

  it("toggles bookmarks and records a read item without duplicates", () => {
    const store = createPersonalizationStore(memoryStorage());

    store.toggleBookmark("official-item-1");
    store.markRead("official-item-1");
    store.markRead("official-item-1");
    store.toggleBookmark("official-item-1");

    expect(store.read().bookmarks).toEqual([]);
    expect(store.read().read).toEqual(["official-item-1"]);
  });

  it("rejects malformed saved filter values", () => {
    const store = createPersonalizationStore(memoryStorage({
      "medi-cal-intelligence:personalization": JSON.stringify({
        version: 1,
        preferences: { source: "unknown", classification: "private", view: "private" },
      }),
    }));

    expect(store.read().preferences.source).toBe("all");
    expect(store.read().preferences.classification).toBe("all");
    expect(store.read().preferences.view).toBe("all");
  });

  it("saves and restores filter preferences", () => {
    const store = createPersonalizationStore(memoryStorage());
    const preferences = { query: "claims", category: "Eligibility", month: "2026-07", source: "bulletin", classification: "regulatory", hpFilter: "Provider Operations", view: "bookmarked" as const };

    store.savePreferences(preferences);

    expect(store.read().preferences).toEqual(preferences);
  });

  it("identifies items published after the prior visit and advances the visit marker", () => {
    const store = createPersonalizationStore(memoryStorage());
    store.setLastVisitedAt("2026-07-01T12:00:00.000Z");

    expect(store.isNewSinceLastVisit("2026-07-02T12:00:00.000Z")).toBe(true);
    expect(store.isNewSinceLastVisit("2026-07-01T12:00:00.000Z")).toBe(false);

    store.recordVisit("2026-07-03T12:00:00.000Z");
    expect(store.read().lastVisitedAt).toBe("2026-07-03T12:00:00.000Z");
  });
});
