import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatNumber, useTranslation } from "../i18n";
import { useTRPC } from "../net/trpc";
import { Avatar, Segmented } from "../ui/kit";
import styles from "./admin.module.css";
import d from "./dashboard.module.css";
import { actionLabel, details, fmt } from "./format";

const PERIODS = ["1h", "24h", "7d"] as const;
type Period = (typeof PERIODS)[number];

/** "Minting exceeds spending by 21%" — or the other way round, or about even (within 5%). */
export function economyVerdict(minted: number, spent: number): { key: "mintedMore" | "spentMore" | "balanced" | "noCoins"; n: number } {
  if (minted === 0 && spent === 0) return { key: "noCoins", n: 0 };
  const low = Math.min(minted, spent);
  const n = low === 0 ? 100 : Math.round((Math.max(minted, spent) / low - 1) * 100);
  if (n < 5) return { key: "balanced", n };
  return { key: minted > spent ? "mintedMore" : "spentMore", n };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={d.tile}>
      <span className={d.tileLabel}>{label}</span>
      <span className={d.tileValue}>{value}</span>
      {sub && <span className={d.tileSub}>{sub}</span>}
    </div>
  );
}

/** Pixels as bars, players online as a line, one point per hour. */
function HourChart({ hours }: { hours: Array<{ hour: number; pixels: number; online: number }> }) {
  const { t } = useTranslation();
  const W = 720;
  const H = 160;
  const n = Math.max(1, hours.length);
  const step = W / n;
  const maxPixels = Math.max(1, ...hours.map((h) => h.pixels));
  const maxOnline = Math.max(1, ...hours.map((h) => h.online));
  const line = hours.map((h, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * step},${H - (h.online / maxOnline) * (H - 8)}`).join(" ");
  return (
    <figure className={d.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t("admin.dashboard.chartLabel")}>
        {hours.map((h, i) => {
          const bh = (h.pixels / maxPixels) * (H - 8);
          return (
            <rect key={h.hour} x={i * step + 1} y={H - bh} width={Math.max(1, step - 2)} height={bh} fill="var(--cyan)" opacity="0.55">
              <title>
                {fmt(h.hour)}: {formatNumber(h.pixels)} / {formatNumber(h.online)}
              </title>
            </rect>
          );
        })}
        <path d={line} fill="none" stroke="var(--pink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className={d.legend}>
        <span className={d.key} data-tone="cyan" /> {t("admin.dashboard.chartPixels")} · max {formatNumber(maxPixels)}
        <span className={d.key} data-tone="pink" /> {t("admin.dashboard.chartOnline")} · max {formatNumber(maxOnline)}
      </figcaption>
    </figure>
  );
}

/** One horizontal bar split by source, with a legend of amounts. */
function Breakdown({ title, parts, tone }: { title: string; parts: Array<[string, number]>; tone: "lime" | "red" }) {
  const total = parts.reduce((s, [, v]) => s + v, 0);
  const shown = parts.filter(([, v]) => v > 0);
  return (
    <div className={d.breakdown}>
      <div className={d.breakdownHead}>
        <span>{title}</span>
        <span className={styles.num}>{formatNumber(total)}</span>
      </div>
      <div className={d.bar} data-tone={tone} aria-hidden="true">
        {shown.map(([k, v], i) => (
          <span key={k} style={{ width: `${(v / Math.max(1, total)) * 100}%`, opacity: 1 - i * 0.14 }} />
        ))}
      </div>
      <ul className={d.parts}>
        {shown.map(([k, v]) => (
          <li key={k}>
            {k} <span className={styles.num}>{formatNumber(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [period, setPeriod] = useState<Period>("24h");
  const query = useQuery({ ...trpc.admin.dashboard.queryOptions({ period }), refetchInterval: 60_000, placeholderData: keepPreviousData });
  const data = query.data;
  const src = (key: string) => t(`admin.dashboard.src.${key}` as "admin.dashboard.src.pixels");

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.h1}>{t("admin.nav.dashboard")}</h1>
        <Segmented
          label={t("admin.period.label")}
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: t(`admin.period.${p}`) }))}
        />
      </div>
      {query.isError && !data && <p className={styles.error}>{t("admin.common.failed")}</p>}
      {!data ? (
        <p className={styles.muted}>{t("common.loading")}</p>
      ) : (
        <>
          <div className={d.tiles}>
            <Tile
              label={t("admin.dashboard.online")}
              value={formatNumber(data.online.now)}
              sub={t("admin.dashboard.onlinePeak", { n: formatNumber(data.online.peak) })}
            />
            <Tile label={t("admin.dashboard.pixels")} value={formatNumber(data.pixels)} />
            <Tile
              label={t("admin.dashboard.bombs")}
              value={`${formatNumber(data.explosions)} / ${formatNumber(data.defuses)}`}
              sub={t("admin.dashboard.activeBombs", { n: formatNumber(data.activeBombs) })}
            />
            <Tile
              label={t("admin.dashboard.coins")}
              value={`${formatNumber(sum(data.coins.minted))} / ${formatNumber(sum(data.coins.spent))}`}
              sub={t("admin.dashboard.inCirculation", { n: formatNumber(data.coins.inCirculation) })}
            />
            <Tile
              label={t("admin.dashboard.newPlayers")}
              value={formatNumber(data.players.new)}
              sub={t("admin.dashboard.tooYoung", { n: formatNumber(data.players.tooYoung) })}
            />
          </div>
          <section className={styles.box}>
            <h2 className={styles.h2}>{t("admin.dashboard.chart")}</h2>
            <HourChart hours={data.hours} />
          </section>
          <div className={styles.grid2}>
            <section className={styles.box}>
              <h2 className={styles.h2}>{t("admin.dashboard.economy")}</h2>
              <Breakdown title={t("admin.dashboard.minted")} tone="lime" parts={Object.entries(data.coins.minted).map(([k, v]) => [src(k), v])} />
              <Breakdown title={t("admin.dashboard.spent")} tone="red" parts={Object.entries(data.coins.spent).map(([k, v]) => [src(k), v])} />
              {(() => {
                const v = economyVerdict(sum(data.coins.minted), sum(data.coins.spent));
                return <p className={d.verdict}>{t(`admin.dashboard.${v.key}`, { n: v.n })}</p>;
              })()}
            </section>
            <section className={styles.box}>
              <h2 className={styles.h2}>{t("admin.dashboard.server")}</h2>
              <dl className={styles.facts}>
                <dt>{t("admin.dashboard.uptime")}</dt>
                <dd className={styles.num}>{uptime(data.server.uptimeSec, t)}</dd>
                <dt>{t("admin.dashboard.commitP99")}</dt>
                <dd className={styles.num}>
                  {data.server.commitP99Ms === null ? t("admin.common.none") : t("admin.dashboard.ms", { n: data.server.commitP99Ms })}
                </dd>
                <dt>{t("admin.dashboard.actions")}</dt>
                <dd className={styles.num}>{formatNumber(data.server.actions)}</dd>
                <dt>{t("admin.dashboard.rejects")}</dt>
                <dd className={styles.num}>{formatNumber(data.server.rejects)}</dd>
                <dt>{t("admin.dashboard.rateLimited")}</dt>
                <dd className={styles.num}>{formatNumber(data.server.rateLimited)}</dd>
                <dt>{t("admin.dashboard.memory")}</dt>
                <dd className={styles.num}>{t("admin.dashboard.mb", { n: formatNumber(data.server.memoryMb) })}</dd>
              </dl>
            </section>
            <section className={styles.box}>
              <h2 className={styles.h2}>{t("admin.dashboard.topActive")}</h2>
              <p className={styles.muted}>{t("admin.dashboard.topColumns")}</p>
              {data.topActive.length === 0 ? (
                <p className={styles.muted}>{t("admin.common.empty")}</p>
              ) : (
                <ul className={styles.list}>
                  {data.topActive.map((r) => (
                    <li key={r.user.id} className={styles.who}>
                      <Avatar user={r.user} size={24} />
                      <a className={styles.link} href={`?tab=players&player=${r.user.id}`}>
                        {r.user.name}
                      </a>
                      <span className={`${styles.num} ${d.right}`}>
                        {formatNumber(r.pixels)} · {r.bombsPlaced} · {r.explosionsCaused}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={styles.box}>
              <h2 className={styles.h2}>{t("admin.dashboard.recentModeration")}</h2>
              {data.recentModeration.length === 0 ? (
                <p className={styles.muted}>{t("admin.common.empty")}</p>
              ) : (
                <ul className={styles.list}>
                  {data.recentModeration.map((e) => (
                    <li key={e.id}>
                      <b>{actionLabel(e.action)}</b> · {e.admin.name}
                      {e.target && ` → ${e.target.name}`} · <span className={styles.muted}>{fmt(e.at)}</span>
                      <div className={styles.muted}>{details(e)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

function uptime(sec: number, t: ReturnType<typeof useTranslation>["t"]): string {
  const hours = Math.floor(sec / 3600);
  return hours > 0 ? t("admin.dashboard.hours", { n: formatNumber(hours) }) : t("admin.dashboard.minutes", { n: Math.floor(sec / 60) });
}
