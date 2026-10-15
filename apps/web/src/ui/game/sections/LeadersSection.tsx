import type { UserRef } from "@rave/shared/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useRef, useState } from "react";
import { BOARDS, type Board, type Period, periodsFor } from "../../../game/leaders";
import { formatNumber, useTranslation } from "../../../i18n";
import { useTRPC } from "../../../net/trpc";
import { useGame } from "../../../state/game-store";
import { uiStore } from "../../../state/ui-store";
import { Avatar, Icon, Segmented } from "../../kit";
import { nextIndex } from "../../kit/keys";
import styles from "./sections.module.css";

interface Row {
  rank: number;
  user: UserRef;
  value: number;
}

function PlayerName({ user, className }: { user: UserRef; className?: string }) {
  return (
    <button
      type="button"
      className={[styles.playerName, className].filter(Boolean).join(" ")}
      title={user.name}
      onClick={() => uiStore.getState().openProfile(user.id)}
    >
      {user.name}
    </button>
  );
}

/** Top three on steps of different heights: second, first, third. */
function Podium({ rows }: { rows: Row[] }) {
  const order = [rows[1], rows[0], rows[2]];
  return (
    <ol className={styles.podium}>
      {order.map((row) =>
        row ? (
          <li key={row.user.id} className={styles.step} data-place={row.rank} value={row.rank}>
            <Avatar user={row.user} size={row.rank === 1 ? 52 : 44} />
            <PlayerName user={row.user} />
            <span className={styles.stepBlock}>
              <span className={styles.stepRank}>{row.rank}</span>
              {formatNumber(row.value)}
            </span>
          </li>
        ) : null,
      )}
    </ol>
  );
}

/** Top 50 per board and period, refreshed every 30 s while open; the server caches rankings for as long. */
export function LeadersSection() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const user = useGame((s) => s.user);
  const [board, setBoard] = useState<Board>("artists");
  const [period, setPeriod] = useState<Period>("day");
  const boardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Territory is "now" only; the server ranks it under `all`.
  const query = useQuery({
    ...trpc.stats.leaderboard.queryOptions({ board, period: board === "territory" ? "all" : period }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const top = query.data?.top ?? [];
  const me = query.data?.me ?? null;
  const meInTop = user !== null && top.some((r) => r.user.id === user.id);

  const onBoardKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(e.key, index, BOARDS.length);
    if (next === null) return;
    e.preventDefault();
    setBoard(BOARDS[next]!.board);
    boardRefs.current[next]?.focus();
  };

  return (
    <div className={styles.stack}>
      <div role="radiogroup" aria-label={t("leaders.boards")} className={styles.boards}>
        {BOARDS.map((b, i) => (
          // biome-ignore lint/a11y/useSemanticElements: a styled radio in a roving-tabindex radiogroup; a native radio cannot render this
          <button
            key={b.board}
            ref={(el) => {
              boardRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={b.board === board}
            tabIndex={b.board === board ? 0 : -1}
            className={styles.board}
            onClick={() => setBoard(b.board)}
            onKeyDown={(e) => onBoardKey(e, i)}
          >
            <Icon name={b.icon} />
            {t(`leaders.${b.board}`)}
          </button>
        ))}
      </div>
      {periodsFor(board).length > 0 && (
        <Segmented
          label={t("leaders.period")}
          value={period}
          onChange={setPeriod}
          options={periodsFor(board).map((p) => ({ value: p, label: t(`leaders.${p}`) }))}
        />
      )}
      <p className={styles.hint}>{t(`leaders.${board}Hint`)}</p>
      {query.isPending && <p className={styles.hint}>{t("common.loading")}</p>}
      {query.isError && !query.data && <p className={styles.hint}>{t("leaders.error")}</p>}
      {query.data && top.length === 0 && <p className={styles.hint}>{t("leaders.empty")}</p>}
      {top.length > 0 && (
        // While another board or period loads, the previous list stays on screen, dimmed.
        <div className={styles.ranking} aria-busy={query.isPlaceholderData || undefined}>
          <Podium rows={top.slice(0, 3)} />
          {top.length > 3 && (
            // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from lists without markers
            <ol className={styles.rankList} role="list" start={4}>
              {top.slice(3).map((row) => (
                <li
                  key={row.user.id}
                  className={styles.rankRow}
                  data-me={row.user.id === user?.id || undefined}
                  aria-current={row.user.id === user?.id ? "true" : undefined}
                >
                  <span className={styles.rankPlace}>{row.rank}</span>
                  <Avatar user={row.user} size={24} />
                  <PlayerName user={row.user} className={styles.grow} />
                  <span className={styles.rankValue}>{formatNumber(row.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {user && me && !meInTop && (
        <div className={styles.myRank}>
          <span className={styles.rankPlace}>{me.rank}</span>
          <Avatar user={user} size={24} />
          <span className={styles.grow}>
            {user.name} · {t("leaders.you")}
          </span>
          <span className={styles.rankValue}>{formatNumber(me.value)}</span>
        </div>
      )}
    </div>
  );
}
