import { describe, expect, test } from "bun:test";
import { Counter, Histogram, Metrics } from "./metrics";

describe("Counter", () => {
  test("counts per label set, renders sorted labels and sums", () => {
    const c = new Counter("x_total", "help");
    c.inc({ type: "place", code: "frozen" });
    c.inc({ code: "frozen", type: "place" }, 2);
    c.inc();
    expect(c.get({ type: "place", code: "frozen" })).toBe(3);
    expect(c.total()).toBe(4);
    expect(c.render()).toEqual(["# HELP x_total help", "# TYPE x_total counter", 'x_total{code="frozen",type="place"} 3', "x_total 1"]);
  });
});

describe("Histogram", () => {
  test("cumulative buckets, sum and count", () => {
    const h = new Histogram("d", "help", [1, 10]);
    for (const v of [0.5, 3, 30]) h.observe(v);
    expect(h.render()).toEqual([
      "# HELP d help",
      "# TYPE d histogram",
      'd_bucket{le="1"} 1',
      'd_bucket{le="10"} 2',
      'd_bucket{le="+Inf"} 3',
      "d_sum 33.5",
      "d_count 3",
    ]);
  });

  test("quantile is the upper bound of the bucket that holds it", () => {
    const h = new Histogram("d", "help", [1, 10, 100]);
    expect(h.quantile(0.99)).toBeNull();
    for (let i = 0; i < 99; i++) h.observe(5);
    h.observe(50);
    expect(h.quantile(0.5)).toBe(10);
    expect(h.quantile(0.99)).toBe(10);
    expect(h.quantile(1)).toBe(100);
    h.observe(1000);
    expect(h.quantile(1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("Metrics", () => {
  test("track counts actions and rejections by code", () => {
    const m = new Metrics();
    m.track("buy", { ok: true });
    m.track("buy", { ok: false, code: "insufficient_coins" });
    expect(m.actions.get({ type: "buy" })).toBe(2);
    expect(m.rejects.get({ type: "buy", code: "insufficient_coins" })).toBe(1);
  });

  test("render includes live gauges and ends with a newline", () => {
    const m = new Metrics();
    let live = 3;
    m.gauge("rave_things", "Things", () => live);
    live = 4;
    const text = m.render();
    expect(text).toContain("# TYPE rave_things gauge\nrave_things 4");
    expect(text).toContain("rave_memory_rss_bytes ");
    expect(text.endsWith("\n")).toBe(true);
  });
});
