import { useQuery } from "@tanstack/react-query";
import { currentLocale, formatNumber, useTranslation } from "../../../i18n";
import { useTRPC } from "../../../net/trpc";
import { useGame } from "../../../state/game-store";
import { useUi } from "../../../state/ui-store";
import { Heatmap } from "../../Heatmap";
import { Avatar, Button, Icon, type IconName } from "../../kit";
import { LanguageSwitch, logout } from "../TopBar";
import styles from "./sections.module.css";

const INVENTORY: Array<{ item: "bomb" | "detector" | "defuser"; icon: IconName; tone: string }> = [
  { item: "bomb", icon: "bomb", tone: "pink" },
  { item: "detector", icon: "detector", tone: "cyan" },
  { item: "defuser", icon: "defuser", tone: "lime" },
];

/** Public counters of any player; coins and inventory only for yourself, from your live player state. */
export function ProfileSection() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const me = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const admin = useGame((s) => s.admin);
  const target = useUi((s) => s.profileUserId) ?? me?.id ?? null;
  const query = useQuery({ ...trpc.stats.profile.queryOptions({ userId: target ?? 0 }), enabled: target !== null });

  if (target === null) return <p className={styles.hint}>{t("profile.loginToSee")}</p>;
  if (query.isPending) return <p className={styles.hint}>{t("common.loading")}</p>;
  if (query.isError) return <p className={styles.hint}>{query.error.data?.code === "NOT_FOUND" ? t("profile.notFound") : t("profile.error")}</p>;
  const p = query.data;
  const own = p.user.id === me?.id;
  const favorite = p.favoriteColor === null ? null : config?.palette.find((e) => e.id === p.favoriteColor);
  const joined = new Date(p.joinedAt).toLocaleDateString(currentLocale());
  const stats: Array<[string, number]> = [
    [own ? t("profile.bombsTriggeredOwn") : t("profile.bombsTriggered"), p.totals.bombsTriggered],
    [t("profile.defused"), p.totals.defused],
    [t("profile.suffered"), p.totals.explosionsSuffered],
    [t("profile.selfExplosions"), p.totals.selfExplosions],
    [t("profile.activeBombs"), p.activeBombs],
  ];

  return (
    <div className={styles.stack}>
      <div className={styles.who}>
        <Avatar user={p.user} size={64} />
        <div className={styles.whoText}>
          <span className={styles.whoName}>
            {p.user.name}
            {own && <span className={styles.badgeMe}>{t("profile.me")}</span>}
            {p.banned && <span className={styles.badgeBanned}>{t("profile.banned")}</span>}
          </span>
          <span className={styles.hint}>{t("profile.joined", { date: joined })}</span>
        </div>
      </div>
      {admin && !own && (
        <a className={styles.link} href={`/admin?tab=players&player=${p.user.id}`}>
          <Icon name="eye" />
          {t("profile.moderate")}
        </a>
      )}
      {own && player && (
        <ul className={styles.inventory} aria-label={t("profile.inventory")}>
          <li className={styles.invItem}>
            <Icon name="coin" label={t("profile.inv_coins")} />
            <span>{formatNumber(player.coins)}</span>
          </li>
          {INVENTORY.map((i) => (
            <li key={i.item} className={styles.invItem} data-tone={i.tone}>
              <Icon name={i.icon} label={t(`profile.inv_${i.item}`)} />
              <span>{player.unlimited ? "∞" : formatNumber(player.inventory[i.item])}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.bigStats}>
        <div className={styles.bigStat}>
          <span className={styles.bigLabel}>{t("profile.territory")}</span>
          <span className={styles.bigValue} data-tone="cyan">
            {formatNumber(p.territory)}
          </span>
        </div>
        <div className={styles.bigStat}>
          <span className={styles.bigLabel}>{t("profile.pixels")}</span>
          <span className={styles.bigValue}>{formatNumber(p.totals.pixels)}</span>
        </div>
      </div>
      <dl className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.statRow}>
            <dt>{label}</dt>
            <dd>{formatNumber(value)}</dd>
          </div>
        ))}
        <div className={styles.statRow}>
          <dt>{t("profile.favorite")}</dt>
          <dd>
            {favorite ? (
              <span
                className={styles.favorite}
                style={{ background: favorite.base }}
                role="img"
                aria-label={favorite.name?.[currentLocale()] ?? t("kit.colorN", { id: favorite.id })}
              />
            ) : (
              t("profile.none")
            )}
          </dd>
        </div>
      </dl>
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{t("profile.heatmap")}</h3>
        {p.heatmap.cells.length > 0 ? (
          <>
            <Heatmap data={p.heatmap} className={styles.heatmap} />
            <div className={styles.legend} aria-hidden="true">
              {t("profile.less")}
              <span style={{ background: "rgba(255, 61, 174, 0.3)" }} />
              <span style={{ background: "rgba(255, 61, 174, 0.55)" }} />
              <span style={{ background: "rgba(255, 61, 174, 0.85)" }} />
              {t("profile.more")}
            </div>
          </>
        ) : (
          <p className={styles.hint}>{t("profile.noPixels")}</p>
        )}
      </section>
      {own && (
        <div className={styles.ownActions}>
          <LanguageSwitch />
          <Button icon="back" onClick={logout}>
            {t("top.logout")}
          </Button>
        </div>
      )}
    </div>
  );
}
