import assert from "node:assert/strict";
import test from "node:test";
import { createNewsCache } from "./news-cache.js";

test("createNewsCache reuses a scrape result within five minutes", async () => {
  let calls = 0;
  const cache = createNewsCache(async () => ++calls, 5 * 60 * 1000);

  assert.equal(await cache.get(), 1);
  assert.equal(await cache.get(), 1);
  assert.equal(calls, 1);
});

test("createNewsCache serves a bounded stale value when refresh fails", async () => {
  let now = 0;
  let shouldFail = false;
  const cache = createNewsCache(async () => {
    if (shouldFail) throw new Error("upstream unavailable");
    return "fresh";
  }, 100, 1_000, () => now);

  assert.equal(await cache.get(), "fresh");
  now = 200;
  shouldFail = true;
  assert.equal(await cache.get(), "fresh");

  now = 1_001;
  await assert.rejects(cache.get(), /upstream unavailable/);
});

test("createNewsCache serves stale data immediately and refreshes in the background", async () => {
  let now = 0;
  let calls = 0;
  let releaseSecond!: (value: string) => void;
  const cache = createNewsCache(async () => {
    calls += 1;
    if (calls === 1) return "first";
    return new Promise<string>((resolve) => { releaseSecond = resolve; });
  }, 100, 1_000, () => now);

  assert.equal(await cache.get(), "first");

  now = 150; // expired (>100) but well within the 1000ms stale cap
  const value = await cache.get();
  assert.equal(value, "first", "stale value is returned without waiting for the refresh");
  assert.equal(calls, 2, "a background refresh was kicked off");

  // A concurrent caller during the same background refresh gets the same stale value,
  // not a second refresh.
  assert.equal(await cache.get(), "first");
  assert.equal(calls, 2);

  releaseSecond("second");
  await new Promise((resolve) => setImmediate(resolve));
  now = 160;
  assert.equal(await cache.get(), "second", "next call after refresh completes sees the fresh value");
});

test("createNewsCache shares one in-flight refresh across callers", async () => {
  let calls = 0;
  let release!: (value: number) => void;
  const cache = createNewsCache(() => {
    calls += 1;
    return new Promise<number>((resolve) => { release = resolve; });
  }, 100);

  const first = cache.get();
  const second = cache.get();
  release(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(calls, 1);
});
