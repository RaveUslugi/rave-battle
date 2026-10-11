import { expect, test } from "bun:test";
import { entryScript, onProtocolMismatch, waitForNewBundle } from "./version";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("first mismatch reloads, a second within a minute asks, after a minute reloads again", () => {
  const storage = memory();
  expect(onProtocolMismatch(storage, 1_000_000)).toBe("reload");
  expect(onProtocolMismatch(storage, 1_030_000)).toBe("ask");
  expect(onProtocolMismatch(storage, 1_061_000)).toBe("reload");
});

test("without storage it always reloads", () => {
  expect(onProtocolMismatch(null, 1)).toBe("reload");
  expect(onProtocolMismatch(null, 2)).toBe("reload");
});

const built = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script><link rel="stylesheet" crossorigin href="/assets/index-x.css"></head><body></body></html>`;

test("entryScript reads the module script of a built index.html", () => {
  expect(entryScript(built("/assets/index-AAA.js"))).toBe("/assets/index-AAA.js");
  expect(entryScript(`<script src="/a.js"></script><script src="/m.js" type="module"></script>`)).toBe("/m.js");
});

test("entryScript returns null without a module script", () => {
  expect(entryScript("<html><script>1</script></html>")).toBeNull();
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

test("waitForNewBundle resolves changed as soon as the entry script differs", async () => {
  const c = clock();
  const pages = [built("/assets/index-OLD.js"), built("/assets/index-OLD.js"), built("/assets/index-NEW.js")];
  let calls = 0;
  const result = await waitForNewBundle({
    fetchHtml: async () => pages[calls++]!,
    current: "/assets/index-OLD.js",
    timeoutMs: 120_000,
    intervalMs: 3000,
    ...c,
  });
  expect(result).toBe("changed");
  expect(calls).toBe(3);
});

test("waitForNewBundle resolves timeout when the script never changes", async () => {
  const c = clock();
  const result = await waitForNewBundle({
    fetchHtml: async () => built("/assets/index-OLD.js"),
    current: "/assets/index-OLD.js",
    timeoutMs: 12_000,
    intervalMs: 3000,
    ...c,
  });
  expect(result).toBe("timeout");
  expect(c.now()).toBeGreaterThanOrEqual(12_000);
});

test("waitForNewBundle tolerates fetch errors and keeps polling", async () => {
  const c = clock();
  let calls = 0;
  const result = await waitForNewBundle({
    fetchHtml: async () => {
      if (++calls < 3) throw new Error("down");
      return built("/assets/index-NEW.js");
    },
    current: "/assets/index-OLD.js",
    timeoutMs: 120_000,
    intervalMs: 3000,
    ...c,
  });
  expect(result).toBe("changed");
});

test("waitForNewBundle times out when fetch keeps failing, and stops when aborted", async () => {
  const c = clock();
  const failing = async () => {
    throw new Error("down");
  };
  expect(await waitForNewBundle({ fetchHtml: failing, current: "/a.js", timeoutMs: 9000, intervalMs: 3000, ...c })).toBe("timeout");
  const ctl = new AbortController();
  ctl.abort();
  expect(await waitForNewBundle({ fetchHtml: failing, current: "/a.js", timeoutMs: 9000, intervalMs: 3000, signal: ctl.signal, ...clock() })).toBe("aborted");
});

test("waitForNewBundle without a current script has nothing to compare and times out at once", async () => {
  expect(await waitForNewBundle({ fetchHtml: async () => built("/x.js"), current: null, timeoutMs: 9000, intervalMs: 3000, ...clock() })).toBe("timeout");
});
