import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BOARD_TABS, formatValue, periodsFor, type Board, type Period } from "../game/leaders";
import { useTRPC } from "../net/trpc";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

/** Top 50 per board and period, refreshed every 30 s while open; the server caches rankings for as long. */
export function LeadersTab() {
  const trpc = useTRPC();
  const user = useGame((s) => s.user);
  const [board, setBoard] = useState<Board>("artists");
  const [period, setPeriod] = useState<Period>("day");
  const query = useQuery({ ...trpc.stats.leaderboard.queryOptions({ board, period }), refetchInterval: 30_000 });
  const tab = BOARD_TABS.find((b) => b.board === board)!;

  return (
    <div className={styles.tab}>
      <div className={styles.segments} role="group" aria-label="Рейтинг">
        {BOARD_TABS.map((b) => (
          <button key={b.board} type="button" className={b.board === board ? styles.segmentOn : styles.segment} aria-pressed={b.board === board} onClick={() => setBoard(b.board)}>
            {b.title}
          </button>
        ))}
      </div>
      {periodsFor(board).length > 0 && (
        <div className={styles.segments} role="group" aria-label="Период">
          {periodsFor(board).map((p) => (
            <button key={p.period} type="button" className={p.period === period ? styles.segmentOn : styles.segment} aria-pressed={p.period === period} onClick={() => setPeriod(p.period)}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      <p className={styles.hint}>{tab.hint}</p>
      {query.isPending && <p className={styles.hint}>Загрузка…</p>}
      {query.isError && <p className={styles.hint}>Не удалось загрузить рейтинг</p>}
      {query.data && query.data.top.length === 0 && <p className={styles.hint}>Пока никого</p>}
      {query.data && query.data.top.length > 0 && (
        <ol className={styles.ranking}>
          {query.data.top.map((row) => (
            <li key={row.user.id} className={row.user.id === user?.id ? styles.rankMe : styles.rank}>
              <span className={styles.place}>{row.rank}</span>
              <button type="button" className={styles.player} onClick={() => uiStore.getState().openProfile(row.user.id)}>
                {row.user.name}
              </button>
              <span className={styles.value}>{formatValue(row.value)}</span>
            </li>
          ))}
        </ol>
      )}
      {query.data?.me && !query.data.top.some((r) => r.user.id === user?.id) && (
        <p className={styles.mine}>
          Вы: № {query.data.me.rank}, {formatValue(query.data.me.value)}
        </p>
      )}
    </div>
  );
}
