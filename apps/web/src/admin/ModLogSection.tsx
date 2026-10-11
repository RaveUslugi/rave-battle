import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ModAction } from "../../../server/src/engine/types";
import { useTRPC } from "../net/trpc";
import styles from "./admin.module.css";
import { ACTION_LABEL, ITEM_LABEL } from "./labels";
import { useSearchParam } from "./useSearchParam";

const fmt = (ms: number) => new Date(ms).toLocaleString("ru-RU");
const ACTIONS = Object.keys(ACTION_LABEL) as ModAction[];
const ITEM_KEYS = Object.keys(ITEM_LABEL) as Array<keyof typeof ITEM_LABEL>;

function details(action: ModAction, p: Record<string, unknown>): string {
  const comment = String(p.comment ?? "");
  switch (action) {
    case "ban":
      return `до ${p.until === "permanent" ? "навсегда" : fmt(Number(p.until))}: ${String(p.reason ?? "")}`;
    case "unban":
      return String(p.reason ?? "");
    case "player_edit": {
      const changes = (p.changes ?? {}) as Record<string, number | undefined>;
      const parts = ITEM_KEYS.flatMap((k) => {
        const d = changes[k];
        return d ? [`${ITEM_LABEL[k]} ${d > 0 ? "+" : "−"}${Math.abs(d)}`] : [];
      });
      return `${parts.join(", ")} — ${comment}`;
    }
    case "config_save":
      return `версия ${String(p.version)} — ${comment}`;
    case "config_rollback":
      return `версия ${String(p.version)} (из ${String(p.fromVersion)}) — ${comment}`;
  }
}

export function ModLogSection() {
  const trpc = useTRPC();
  const [, setTab] = useSearchParam("tab");
  const [, setPlayer] = useSearchParam("player");
  const [action, setAction] = useState<ModAction | "">("");
  const [playerText, setPlayerText] = useState("");
  const targetUserId = /^\d+$/.test(playerText.trim()) && Number(playerText) > 0 ? Number(playerText) : undefined;

  const log = useInfiniteQuery(
    trpc.admin.modLog.infiniteQueryOptions(
      { ...(action !== "" ? { action } : {}), ...(targetUserId !== undefined ? { targetUserId } : {}) },
      { getNextPageParam: (last) => last.next ?? undefined },
    ),
  );
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  const openPlayer = (id: number) => {
    setPlayer(String(id));
    setTab("players");
  };

  return (
    <section>
      <div className={styles.row}>
        <label className={styles.field}>
          Действие
          <select className={styles.input} value={action} onChange={(e) => setAction(e.target.value as ModAction | "")}>
            <option value="">Все</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Игрок (id)
          <input className={styles.input} inputMode="numeric" value={playerText} onChange={(e) => setPlayerText(e.target.value)} />
        </label>
      </div>
      {log.isError && <p className={styles.error}>Не удалось загрузить журнал</p>}
      {log.isPending && <p className={styles.message}>Загрузка…</p>}
      {log.data && entries.length === 0 && <p className={styles.message}>Записей нет</p>}
      {entries.length > 0 && (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Админ</th>
                <th>Действие</th>
                <th>Цель</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{fmt(e.at)}</td>
                  <td>{e.admin.name}</td>
                  <td>{ACTION_LABEL[e.action]}</td>
                  <td>
                    {e.target ? (
                      <>
                        <button type="button" className={styles.linkButton} onClick={() => openPlayer(e.target!.id)}>
                          {e.target.name}
                        </button>{" "}
                        <button type="button" className={styles.linkButton} onClick={() => setPlayerText(String(e.target!.id))}>
                          только этот игрок
                        </button>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={styles.wrap}>{details(e.action, e.params)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.hasNextPage && (
        <button type="button" className={styles.button} disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          Показать ещё
        </button>
      )}
    </section>
  );
}
