import assert from "node:assert/strict";
import test from "node:test";
import { NewsQueryParams } from "./news.js";

test("NewsQueryParams strictly validates body and pagination controls", () => {
  assert.equal(NewsQueryParams.parse({ includeBody: "false" }).includeBody, false);
  assert.equal(NewsQueryParams.safeParse({ includeBody: "banana" }).success, false);
  assert.equal(NewsQueryParams.parse({ limit: "25", offset: "0" }).limit, 25);
  assert.equal(NewsQueryParams.safeParse({ limit: "101" }).success, false);
  assert.equal(NewsQueryParams.safeParse({ offset: "-1" }).success, false);
});
