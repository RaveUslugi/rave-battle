import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTRPC } from "../net/trpc";
import { useSearchParam } from "./AdminApp";
import styles from "./admin.module.css";
import { PlayerCard } from "./PlayerCard";

const DEBOUNCE_MS = 300;

export function PlayersSection() {
  const trpc = useTRPC();
  const [playerParam, setPlayerParam] = useSearchParam("player");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useQuery({ ...trpc.admin.players.search.queryOptions({ q }), enabled: q.length > 0 });
  const userId = playerParam !== null && /^\d+$/.test(playerParam) ? Number(playerParam) : null;

  return (
    <section>
      <input
        className={styles.input}
        type="search"
        placeholder="Имя, #id или Discord ID"
        aria-label="Поиск игрока"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {q.length > 0 && search.isError && <p className={styles.error}>Не удалось выполнить поиск</p>}
      {q.length > 0 && search.data?.length === 0 && <p className={styles.message}>Никого не нашли</p>}
      {search.data && search.data.length > 0 && (
        <ul className={styles.results}>
          {search.data.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.result} aria-pressed={userId === p.id} onClick={() => setPlayerParam(String(p.id))}>
                {p.name} · #{p.id} · {p.discordId}
                {p.banned && <span className={styles.badge}> · заблокирован</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {userId !== null && <PlayerCard key={userId} userId={userId} />}
    </section>
  );
}
