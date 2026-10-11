import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ModAction } from "@rave/shared/client";
import { useTRPC } from "../net/trpc";
import styles from "./admin.module.css";
import { ACTION_LABEL } from "./labels";
import { details, fmt } from "./log-format";
import { useSearchParam } from "./useSearchParam";

const MAX_USER_ID = 2_147_483_647;
const ACTIONS = Object.keys(ACTION_LABEL) as ModAction[];

export function ModLogSection() {
  const trpc = useTRPC();
  const [, setTab] = useSearchParam("tab");
  const [, setPlayer] = useSearchParam("player");
  const [action, setAction] = useState<ModAction | "">("");
  const [playerText, setPlayerText] = useState("");
  const trimmed = playerText.trim();
  const playerNumber = trimmed === "" ? undefined : Number(trimmed);
  const badPlayer = playerNumber !== undefined && (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(playerNumber) || playerNumber < 1 || playerNumber > MAX_USER_ID);
  const targetUserId = badPlayer ? undefined : playerNumber;

  const log = useInfiniteQuery(
    trpc.admin.modLog.infiniteQueryOptions(
      { ...(action !== "" ? { action } : {}), ...(targetUserId !== undefined ? { targetUserId } : {}) },
      { getNextPageParam: (last) => last.next ?? undefined, placeholderData: keepPreviousData, enabled: !badPlayer },
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
          <input className={styles.input} inputMode="numeric" value={playerText} aria-invalid={badPlayer} onChange={(e) => setPlayerText(e.target.value)} />
          {badPlayer && <span className={styles.error}>Неверный id</span>}
        </label>
      </div>
      {!badPlayer && log.isError && <p className={styles.error}>Не удалось загрузить журнал</p>}
      {!badPlayer && log.isPending && <p className={styles.message}>Загрузка…</p>}
      {!badPlayer && log.data && entries.length === 0 && <p className={styles.message}>Записей нет</p>}
      {!badPlayer && entries.length > 0 && (
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
                  <td className={styles.wrap}>{details(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!badPlayer && log.hasNextPage && (
        <button type="button" className={styles.button} disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          Показать ещё
        </button>
      )}
    </section>
  );
}
