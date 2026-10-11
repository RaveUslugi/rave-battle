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
