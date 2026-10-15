import { useLayoutEffect, useRef, useState } from "react";
import { useServerNow } from "../hooks/useNow";
import { feedParts, useFeed, type FeedEntry } from "../state/feed-store";
import { uiStore } from "../state/ui-store";
import styles from "./Feed.module.css";

const COLLAPSED = 3;
const FRESH_MS = 10_000;
const time = (at: number) => new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Explosions and defuses without coordinates: the latest few, expandable to the full history. */
export function Feed() {
  const entries = useFeed((s) => s.entries);
  if (entries.length === 0) return null;
  return <FeedPanel entries={entries} />;
}

function FeedPanel({ entries }: { entries: FeedEntry[] }) {
  const [open, setOpen] = useState(false);
  // `at` is server time, so freshness is measured against the server clock.
  const now = useServerNow(1_000);
  const list = useRef<HTMLOListElement>(null);
  // Oldest first, so keep the newest entries in view when the list opens or grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; the effect resets state when they change
  useLayoutEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, entries]);
  const shown = open ? entries : entries.slice(-COLLAPSED);
  return (
    <section className={styles.feed} aria-label="Лента событий">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        Лента <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      <ol ref={list} className={open ? styles.listOpen : styles.list}>
        {shown.map((e) => (
          <li key={e.id} className={now - e.at < FRESH_MS ? styles.fresh : styles.item}>
            <time className={styles.time} dateTime={new Date(e.at).toISOString()}>
              {time(e.at)}
            </time>{" "}
            {feedParts(e).map((part, i) =>
              typeof part === "string" ? (
                part
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list, items never reorder
                <button key={i} type="button" className={styles.name} onClick={() => uiStore.getState().openProfile(part.id)}>
                  {part.name}
                </button>
              ),
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
