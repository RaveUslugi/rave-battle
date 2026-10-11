import { useQuery } from "@tanstack/react-query";
import { formatValue } from "../game/leaders";
import { useTRPC } from "../net/trpc";
import { useGame } from "../state/game-store";
import { useUi } from "../state/ui-store";
import { Heatmap } from "./Heatmap";
import styles from "./Tabs.module.css";

/** Public counters of any player; coins and inventory only for yourself, from your live player state. */
export function ProfileTab() {
  const trpc = useTRPC();
  const me = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const admin = useGame((s) => s.admin);
  const target = useUi((s) => s.profileUserId) ?? me?.id ?? null;
  const query = useQuery({ ...trpc.stats.profile.queryOptions({ userId: target ?? 0 }), enabled: target !== null });

  if (target === null) return <p className={styles.hint}>Войдите, чтобы увидеть свой профиль</p>;
  if (query.isPending) return <p className={styles.hint}>Загрузка…</p>;
  if (query.isError) return <p className={styles.hint}>{query.error.data?.code === "NOT_FOUND" ? "Профиль не найден" : "Не удалось загрузить профиль"}</p>;
  const p = query.data;
  const own = p.user.id === me?.id;
  const favorite = p.favoriteColor === null ? null : config?.palette.find((e) => e.id === p.favoriteColor);
  const stats: Array<[string, number]> = [
    ["🎨 Пикселей", p.totals.pixels],
    ["🗺 Территория", p.territory],
    [own ? "💣 Подрывов на моих бомбах" : "💣 Подрывов на бомбах игрока", p.totals.bombsTriggered],
    ["🧯 Обезврежено", p.totals.defused],
    ["💥 Подрывов на чужих", p.totals.explosionsSuffered],
    ["🤦 Самоподрывов", p.totals.selfExplosions],
    ["⏳ Активных бомб", p.activeBombs],
  ];

  return (
    <div className={styles.tab}>
      <h3 className={styles.profileName}>
        {p.user.name}
        {own && <span className={styles.badgeMe}> · это вы</span>}
        {p.banned && <span className={styles.badgeBanned}> · заблокирован</span>}
      </h3>
      {admin && !own && <a href={`/admin?tab=players&player=${p.user.id}`}>Модерировать</a>}
      <p className={styles.hint}>В игре с {new Date(p.joinedAt).toLocaleDateString("ru-RU")}</p>
      {own && player && (
        <p className={styles.balance}>
          {player.coins} 🪙 · 💣 {player.inventory.bomb} · 🔍 {player.inventory.detector} · 🧯 {player.inventory.defuser}
        </p>
      )}
      <dl className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <dt>{label}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
        <div className={styles.stat}>
          <dt>❤ Любимый цвет</dt>
          <dd>{favorite ? <span className={styles.swatch} style={{ background: favorite.base }} role="img" aria-label={`Цвет ${favorite.id}`} /> : "—"}</dd>
        </div>
      </dl>
      <h3 className={styles.section}>Где рисует</h3>
      {p.heatmap.cells.length > 0 ? <Heatmap data={p.heatmap} /> : <p className={styles.hint}>Пока ни одного пикселя</p>}
    </div>
  );
}
