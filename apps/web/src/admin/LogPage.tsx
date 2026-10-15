import { MOD_ACTIONS, type ModAction, type Rect } from "@rave/shared/client";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "../i18n";
import { useTRPC } from "../net/trpc";
import { Button, Field, Icon, type IconName, Input } from "../ui/kit";
import styles from "./admin.module.css";
import { actionLabel, details, entryArea, fmt } from "./format";
import { setSearchParams } from "./useSearchParam";

const MAX_USER_ID = 2_147_483_647;

const ACTION_ICON: Record<ModAction, IconName> = {
  ban: "ban",
  unban: "check",
  player_edit: "coin",
  config_save: "sliders",
  config_rollback: "undo",
  rollback_player: "undo",
  clear_area: "area",
  remove_bombs: "bomb",
  chat_mute: "chat",
  chat_unmute: "chat",
  chat_delete: "close",
};

export const openPlayer = (id: number) => setSearchParams({ tab: "players", player: id }, true);
export const openArea = (r: Rect) => setSearchParams({ tab: "canvas", area: `${r.x1},${r.y1},${r.x2},${r.y2}` }, true);

/** The moderation log, newest first, filtered by action and target player. */
export function LogPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [action, setAction] = useState<ModAction | "">("");
  const [playerText, setPlayerText] = useState("");
  const trimmed = playerText.trim().replace(/^#/, "");
  const playerNumber = trimmed === "" ? undefined : Number(trimmed);
  const badPlayer = playerNumber !== undefined && (!/^\d+$/.test(trimmed) || playerNumber < 1 || playerNumber > MAX_USER_ID);
  const targetUserId = badPlayer ? undefined : playerNumber;

  const log = useInfiniteQuery(
    trpc.admin.modLog.infiniteQueryOptions(
      { ...(action !== "" ? { action } : {}), ...(targetUserId !== undefined ? { targetUserId } : {}) },
      { getNextPageParam: (last) => last.next ?? undefined, placeholderData: keepPreviousData, enabled: !badPlayer },
    ),
  );
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.h1}>{t("admin.nav.log")}</h1>
      </div>
      <div className={styles.row}>
        <label className={styles.row}>
          <span className={styles.muted}>{t("admin.log.filterAction")}</span>
          <select className={styles.select} value={action} onChange={(e) => setAction(e.target.value as ModAction | "")}>
            <option value="">{t("admin.log.allActions")}</option>
            {MOD_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <Field label={t("admin.log.filterPlayer")} error={badPlayer ? t("admin.issue.type") : undefined}>
          {(c) => <Input {...c} inputMode="numeric" value={playerText} onChange={(e) => setPlayerText(e.target.value)} />}
        </Field>
      </div>
      <section className={styles.box}>
        {log.isError && <p className={styles.error}>{t("admin.common.failed")}</p>}
        {log.data && entries.length === 0 && <p className={styles.muted}>{t("admin.common.empty")}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("admin.log.what")}</th>
                <th>{t("admin.log.who")}</th>
                <th>{t("admin.log.target")}</th>
                <th />
                <th>{t("admin.log.when")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const area = entryArea(e);
                return (
                  <tr key={e.id}>
                    <td>
                      <span className={styles.who}>
                        <Icon name={ACTION_ICON[e.action]} />
                        <b>{actionLabel(e.action)}</b>
                      </span>
                    </td>
                    <td>{e.admin.name}</td>
                    <td>
                      {e.target ? (
                        <button type="button" className={styles.linkButton} onClick={() => openPlayer(e.target!.id)}>
                          {e.target.name}
                        </button>
                      ) : (
                        t("admin.common.none")
                      )}
                    </td>
                    <td>
                      {details(e)}
                      {area && (
                        <>
                          {" "}
                          <button type="button" className={styles.linkButton} onClick={() => openArea(area)}>
                            {t("admin.log.openArea")}
                          </button>
                        </>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(e.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {log.hasNextPage && (
          <Button disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {t("admin.common.loadMore")}
          </Button>
        )}
      </section>
    </div>
  );
}
