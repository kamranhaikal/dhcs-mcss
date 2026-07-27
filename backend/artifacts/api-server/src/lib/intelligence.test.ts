import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveNewsIntelligence,
  isRecentlyRevised,
  searchNewsItems,
  type SearchableNewsItem,
} from "./intelligence.js";

const dates = {
  publishedDate: new Date("2026-01-01T00:00:00.000Z"),
  revisedDate: null,
};

test("derives only source-supported action metadata and leaves uncertain fields empty", () => {
  const result = deriveNewsIntelligence({
    title: "Provider bulletin",
    summary: "Providers must submit the updated TAR by March 15, 2026.",
    body: null,
    ...dates,
  });

  assert.equal(result.actionRequired, true);
  assert.equal(result.actionSummary, "Providers must submit the updated TAR by March 15, 2026.");
  assert.equal(result.deadlineDate, "March 15, 2026");
  assert.deepEqual(result.affectedEntities, ["Providers"]);
  assert.deepEqual(result.keyPrograms, ["TAR"]);
  assert.equal(result.effectiveDate, null);
  assert.equal(result.extractionConfidence, "high");

  const uncertain = deriveNewsIntelligence({
    title: "Program update",
    summary: "The department is considering changes next year.",
    body: null,
    ...dates,
  });
  assert.equal(uncertain.actionRequired, false);
  assert.equal(uncertain.actionSummary, null);
  assert.equal(uncertain.deadlineDate, null);
  assert.deepEqual(uncertain.affectedEntities, []);
  assert.deepEqual(uncertain.keyPrograms, []);
});

test("extracts explicit effective and deadline dates without normalizing source wording", () => {
  const result = deriveNewsIntelligence({
    title: "FQHC billing change",
    summary: "Effective July 1, 2026, FQHCs are required to use the new HCPCS code. Submit claims by August 15, 2026.",
    body: null,
    ...dates,
  });

  assert.equal(result.effectiveDate, "July 1, 2026");
  assert.equal(result.deadlineDate, "August 15, 2026");
  assert.deepEqual(result.affectedEntities, ["FQHCs"]);
  assert.deepEqual(result.keyPrograms, ["FQHC", "FQHCs", "HCPCS"]);
});

test("uses revisedDate only when it is later than publishedDate", () => {
  assert.equal(isRecentlyRevised(new Date("2026-02-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")), true);
  assert.equal(isRecentlyRevised(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")), false);
  assert.equal(isRecentlyRevised(null, new Date("2026-01-01T00:00:00Z")), false);

  assert.equal(deriveNewsIntelligence({ ...dates, revisedDate: new Date("2026-01-02T00:00:00Z"), title: "Updated", summary: "", body: null }).changeStatus, "revised");
});

const baseItem = (title: string, summary: string, body: string | null): SearchableNewsItem => ({ title, summary, body });

test("searches quoted phrases and unambiguous Medi-Cal aliases with title-weighted relevance", () => {
  const results = searchNewsItems([
    baseItem("HCPCS billing notice", "Routine update", null),
    baseItem("Provider update", "Healthcare Common Procedure Coding System billing notice", null),
    baseItem("Archive", "", "Healthcare Common Procedure Coding System billing notice"),
  ], '"HCPCS billing"');
  assert.deepEqual(results.map((result) => result.item.title), ["HCPCS billing notice"]);

  const aliasResults = searchNewsItems([
    baseItem("HCPCS update", "", null),
    baseItem("Provider update", "Healthcare Common Procedure Coding System update", null),
    baseItem("Archive", "", "Healthcare Common Procedure Coding System update"),
  ], "Healthcare Common Procedure Coding System");
  assert.deepEqual(aliasResults.map((result) => result.item.title), ["HCPCS update", "Provider update", "Archive"]);
});

test("returns text-only bounded snippets and ranges without HTML", () => {
  const [result] = searchNewsItems([
    baseItem("<b>TAR</b> update", "Providers must submit a TAR by March 15, 2026.", null),
  ], "TAR");

  assert.equal(result.snippet.text.includes("<b>"), false);
  assert.deepEqual(result.snippet.ranges, [{ start: 0, end: 3 }]);
  assert.equal(result.snippet.text.startsWith("TAR"), true);
});

test("does not label agency announcements as reader-required actions", () => {
  for (const summary of [
    "DHCS will implement the new service next year.",
    "The department completed the transition.",
    "A transition to the new system is planned.",
  ]) {
    const result = deriveNewsIntelligence({ title: "Program update", summary, body: null, ...dates });
    assert.equal(result.actionRequired, false, summary);
    assert.equal(result.actionSummary, null, summary);
  }
});

test("matches singular alias searches against plural Medi-Cal terms", () => {
  assert.equal(searchNewsItems([baseItem("FQHCs update", "", null)], "FQHC").length, 1);
  assert.equal(searchNewsItems([baseItem("TARs update", "", null)], "TAR").length, 1);
});

test("keeps the most specific explicitly named Medi-Cal program", () => {
  const result = deriveNewsIntelligence({
    title: "Managed care update",
    summary: "Medi-Cal Managed Care guidance was published.",
    body: null,
    ...dates,
  });
  assert.deepEqual(result.keyPrograms, ["Medi-Cal Managed Care"]);
});
