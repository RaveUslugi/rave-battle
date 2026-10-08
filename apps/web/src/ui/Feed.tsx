import { useState } from "react";
import { useServerNow } from "../hooks/useNow";
import { feedText, useFeed } from "../state/feed-store";
import styles from "./Feed.module.css";

const COLLAPSED = 3;
const FRESH_MS = 10_000;
const time = (at: number) => new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Explosions and defuses without coordinates: the latest few, expandable to the full history. */
export function Feed() {
  const entries = useFeed((s) => s.entries);
  const [open, setOpen] = useState(false);
  // `at` is server time, so freshness is measured against the server clock.
  const now = useServerNow(1_000);
  if (entries.length === 0) return null;
  const shown = open ? entries : entries.slice(-COLLAPSED);
  return (
    <section className={styles.feed} aria-label="Лента событий">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        Лента {open ? "▾" : "▸"}
      </button>
      <ol className={open ? styles.listOpen : styles.list}>
        {shown.map((e) => (
          <li key={e.id} className={now - e.at < FRESH_MS ? styles.fresh : styles.item}>
            <time className={styles.time}>{time(e.at)}</time> {feedText(e)}
          </li>
        ))}
      </ol>
    </section>
  );
}
