const KEY = "rb_reload_at";
const MIN_INTERVAL_MS = 60_000;

/** What to do when the server speaks another protocol: reload once, or ask the user if we just did. */
export function onProtocolMismatch(storage: Pick<Storage, "getItem" | "setItem"> | null, now: number): "reload" | "ask" {
  if (!storage) return "reload";
  const last = Number(storage.getItem(KEY) ?? 0);
  if (now - last < MIN_INTERVAL_MS) return "ask";
  storage.setItem(KEY, String(now));
  return "reload";
}

/** The src of the entry module script in an index.html (the hashed bundle in a production build). */
export function entryScript(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (src) return src[1]!;
  }
  return null;
}

function pathOf(src: string): string {
  try {
    return new URL(src, "http://x").pathname;
  } catch {
    return src;
  }
}

export interface WaitForBundle {
  fetchHtml(): Promise<string>;
  /** Entry script of the running page; null when there is none to compare with. */
  current: string | null;
  timeoutMs: number;
  intervalMs: number;
  now(): number;
  sleep(ms: number): Promise<void>;
  signal?: AbortSignal;
}

/** Polls index.html until its entry script differs from the running one (a new build is served). */
export async function waitForNewBundle(deps: WaitForBundle): Promise<"changed" | "timeout" | "aborted"> {
  if (deps.current === null) return "timeout";
  const current = pathOf(deps.current);
  const deadline = deps.now() + deps.timeoutMs;
  while (true) {
    if (deps.signal?.aborted) return "aborted";
    try {
      const src = entryScript(await deps.fetchHtml());
      if (src !== null && pathOf(src) !== current) return "changed";
    } catch {
      // Server restarting; keep polling until the deadline.
    }
    if (deps.now() >= deadline) return "timeout";
    await deps.sleep(deps.intervalMs);
  }
}
