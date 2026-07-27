import assert from "node:assert/strict";
import test from "node:test";
import { ExportQueryParams } from "./export.js";

test("ExportQueryParams accepts the same filters as /api/news and rejects invalid enums", () => {
  assert.deepEqual(ExportQueryParams.parse({}), {});
  assert.equal(ExportQueryParams.parse({ source: "alert" }).source, "alert");
  assert.equal(ExportQueryParams.parse({ classification: "regulatory" }).classification, "regulatory");
  assert.equal(ExportQueryParams.parse({ hpMapping: "Provider Operations" }).hpMapping, "Provider Operations");
  assert.equal(ExportQueryParams.safeParse({ source: "bogus" }).success, false);
  assert.equal(ExportQueryParams.safeParse({ classification: "bogus" }).success, false);
});

test("ExportQueryParams has no pagination controls — export stays unpaginated", () => {
  assert.equal("limit" in ExportQueryParams.shape, false);
  assert.equal("offset" in ExportQueryParams.shape, false);
});
