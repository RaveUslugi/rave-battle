import { expect, test } from "bun:test";
import { TokenBucket } from "./rate-limit";

test("allows a burst up to capacity, then refills over time", () => {
  const bucket = new TokenBucket(3, 2, 0);
  expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
  expect(bucket.take(499)).toBe(false);
  expect(bucket.take(500)).toBe(true);
});

test("never stores more than capacity", () => {
  const bucket = new TokenBucket(2, 10, 0);
  expect([bucket.take(60_000), bucket.take(60_000), bucket.take(60_000)]).toEqual([true, true, false]);
});

test("a backward clock step does not drain the bucket", () => {
  const bucket = new TokenBucket(3, 2, 10_000);
  expect(bucket.take(10_000)).toBe(true);
  expect(bucket.take(0)).toBe(true);
});
