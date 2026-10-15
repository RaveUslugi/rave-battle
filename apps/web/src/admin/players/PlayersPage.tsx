import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatNumber, formatRelative, useTranslation } from "../../i18n";
import { useTRPC } from "../../net/trpc";
import { Avatar, Button, Icon } from "../../ui/kit";
import styles from "../admin.module.css";
import { useSearchParams } from "../useSearchParam";
import { PlayerCard } from "./PlayerCard";

const FILTERS = ["all", "online", "banned", "new", "muted"] as const;
const COLUMNS = ["player", "status", "pixels7d", "coins", "activeBombs", "lastSeen"] as const;
type Sort = "pixels7d" | "coins" | "activeBombs" | "lastSeen" | "name" | "registered";
/** Which sort each column header uses; status has none. */
const SORT_OF: Partial<Record<(typeof COLUMNS)[number], Sort>> = {
  player: "name",
  pixels7d: "pixels7d",
  coins: "coins",
  activeBombs: "activeBombs",
  lastSeen: "lastSeen",
};
const DEBOUNCE_MS = 300;

const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

export function PlayersPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const filter = pick(params.get("filter"), FILTERS, "all");
  const sort = pick(params.get("sort"), ["pixels7d", "coins", "activeBombs", "lastSeen", "name", "registered"] as const, "pixels7d");
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(0, Number(params.get("page")) || 0);
  const selected = Number(params.get("player")) || null;

  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const list = useQuery({ ...trpc.admin.players.list.queryOptions({ filter, sort, dir, page }), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const search = useQuery({ ...trpc.admin.players.search.queryOptions({ q }), enabled: q.length > 0 });
  const now = Date.now();
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  const sortBy = (s: Sort) => setParams({ sort: s, dir: s === sort && dir === "desc" ? "asc" : "desc", page: null });

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.h1}>{t("admin.nav.players")}</h1>
        <input
          className={styles.select}
          type="search"
          placeholder={t("admin.players.searchHint")}
          aria-label={t("admin.players.search")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {q.length > 0 && (
        <section className={styles.box}>
          {search.data?.length === 0 && <p className={styles.muted}>{t("admin.players.notFound")}</p>}
          {search.isError && <p className={styles.error}>{t("admin.common.failed")}</p>}
          <ul className={styles.list}>
            {search.data?.map((p) => (
              <li key={p.id}>
                <button type="button" className={styles.linkButton} onClick={() => setParams({ player: p.id })}>
                  {p.name} · #{p.id} · {p.discordId}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a styled group of toggle buttons, not a form fieldset */}
      <div className={styles.chips} role="group" aria-label={t("admin.players.filters")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={styles.chip}
            aria-pressed={filter === f}
            onClick={() => setParams({ filter: f === "all" ? null : f, page: null })}
          >
            {t(`admin.players.filter.${f}`)}
            {list.data && <span className={styles.num}>{formatNumber(list.data.counts[f])}</span>}
          </button>
        ))}
      </div>
      <section className={styles.box}>
        {list.isError && !list.data && <p className={styles.error}>{t("admin.common.failed")}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-busy={list.isPlaceholderData || undefined}>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const s = SORT_OF[c];
                  const active = s === sort;
                  return (
                    <th key={c} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                      {s ? (
                        <button
                          type="button"
                          className={styles.sort}
                          data-active={active || undefined}
                          data-dir={active ? dir : undefined}
                          onClick={() => sortBy(s)}
                        >
                          {t(`admin.players.col.${c}`)}
                          {active && <Icon name="chevronDown" size={12} />}
                        </button>
                      ) : (
                        t(`admin.players.col.${c}`)
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((r) => (
                <tr key={r.id} data-selected={selected === r.id || undefined}>
                  <td>
                    <div className={styles.who}>
                      <Avatar user={r} size={28} />
                      <div className={styles.whoText}>
                        <button type="button" className={styles.linkButton} onClick={() => setParams({ player: r.id })}>
                          {r.name}
                        </button>
                        <span className={styles.whoSub}>
                          #{r.id} · {r.discordId}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={styles.chips}>
                      <span className={styles.badge} data-tone={r.online ? "online" : undefined}>
                        {t(r.online ? "admin.players.status.online" : "admin.players.status.offline")}
                      </span>
                      {r.banned && (
                        <span className={styles.badge} data-tone="banned">
                          {t("admin.players.status.banned")}
                        </span>
                      )}
                      {r.isNew && (
                        <span className={styles.badge} data-tone="new">
                          {t("admin.players.status.new")}
                        </span>
                      )}
                      {r.muted && (
                        <span className={styles.badge} data-tone="muted">
                          {t("admin.players.status.muted")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={styles.num}>{formatNumber(r.pixels7d)}</td>
                  <td className={styles.num}>{r.coins === null ? t("admin.common.none") : formatNumber(r.coins)}</td>
                  <td className={styles.num}>{formatNumber(r.activeBombs)}</td>
                  <td>{r.lastSeenAt === null ? t("admin.common.never") : formatRelative(r.lastSeenAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <div className={styles.row}>
            <span className={styles.muted}>{t("admin.players.total", { n: formatNumber(list.data.total) })}</span>
            <span style={{ flex: 1 }} />
            <Button disabled={page === 0} onClick={() => setParams({ page: page - 1 || null })}>
              {t("admin.players.prev")}
            </Button>
            <span className={styles.muted}>{t("admin.players.page", { n: page + 1, total: pages })}</span>
            <Button disabled={page + 1 >= pages} onClick={() => setParams({ page: page + 1 })}>
              {t("admin.players.next")}
            </Button>
          </div>
        )}
      </section>
      {selected !== null && <PlayerCard key={selected} userId={selected} onClose={() => setParams({ player: null, cardTab: null })} />}
    </div>
  );
}
