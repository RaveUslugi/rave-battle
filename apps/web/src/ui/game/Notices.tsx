import type { PlayerView } from "@rave/shared/client";
import { useEffect, useState } from "react";
import { effectiveAccess } from "../../game/access";
import { isFrozen } from "../../game/charges";
import { useNow, useServerNow } from "../../hooks/useNow";
import { currentLocale, formatNumber, formatRelative, useTranslation } from "../../i18n";
import { useGame } from "../../state/game-store";
import { readingAt, useReadings } from "../../state/readings-store";
import { type Toast as ToastData, uiStore, useUi } from "../../state/ui-store";
import { Icon, Toast } from "../kit";
import styles from "./layout.module.css";
import { clock } from "./resources";

const TOAST_MS = 4000;
const date = (ms: number) => new Date(ms).toLocaleString(currentLocale());

/** After an explosion: who froze you, the penalty and a big countdown. Only the title is announced, not every tick. */
function FreezePlate() {
  const { t } = useTranslation();
  const player = useGame((s) => s.player);
  const explosion = useUi((s) => s.explosion);
  const now = useServerNow(250);
  if (!player || !isFrozen(player, now)) return null;
  const title = explosion ? (explosion.self ? t("state.frozenSelf") : t("state.frozenBy", { owner: explosion.bombOwner })) : t("state.frozen");
  return (
    <div className={styles.freeze} role="status">
      <Icon name="freeze" size={24} className={styles.freezeIcon} />
      <div className={styles.freezeText}>
        <span className={styles.freezeTitle}>{title}</span>
        {explosion && explosion.coinsLost > 0 && <span className={styles.penalty}>{t("state.penalty", { n: formatNumber(explosion.coinsLost) })}</span>}
      </div>
      <span className={styles.freezeTimer} aria-hidden="true">
        {clock(player.frozenUntil - now)}
      </span>
    </div>
  );
}

export function accessText(player: PlayerView, access: Exclude<ReturnType<typeof effectiveAccess>, "ok">, t: ReturnType<typeof useTranslation>["t"]): string {
  if (access === "banned") {
    const base =
      player.bannedUntil === "permanent" || player.bannedUntil === null ? t("state.banned") : t("state.bannedUntil", { until: date(player.bannedUntil) });
    return player.banReason ? `${base}. ${t("state.reason", { reason: player.banReason })}` : base;
  }
  if (access === "not_guild_member") return t("state.guild");
  return t("state.tooNew", { at: player.playableAt === null ? "…" : date(player.playableAt) });
}

/** Why the player may only watch; the most important block when several hold. */
function AccessStrip() {
  const { t } = useTranslation();
  const player = useGame((s) => s.player);
  const now = useServerNow(1000);
  if (!player) return null;
  const access = effectiveAccess(player, now);
  if (access === "ok") return null;
  return (
    <div className={styles.access} role="status">
      {accessText(player, access, t)} — {t("state.watchOnly")}
    </div>
  );
}

function ToastItem({ toast }: { toast: ToastData }) {
  useEffect(() => {
    const id = setTimeout(() => uiStore.getState().dismissToast(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id]);
  return (
    <Toast tone={toast.tone} icon={toast.icon} count={toast.count}>
      {toast.text}
    </Toast>
  );
}

/**
 * Short messages that dismiss themselves. The live regions stay mounted: screen readers often skip
 * content of a region that is inserted together with it.
 */
function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className={styles.toasts}>
      <div className={styles.toasts} role="alert">
        {toasts
          .filter((t) => t.tone === "error")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
      <div className={styles.toasts} role="status">
        {toasts
          .filter((t) => t.tone !== "error")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
    </div>
  );
}

export function Notices() {
  return (
    <div className={styles.notices}>
      <FreezePlate />
      <AccessStrip />
      <Toasts />
    </div>
  );
}

/** Desktop: the hovered cell's coordinates (and its detector reading) next to the mouse. */
export function CursorLabel() {
  const { t } = useTranslation();
  const hover = useGame((s) => s.hover);
  const readings = useReadings((s) => s.readings);
  const now = useNow(30_000);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => setPos(e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null);
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  if (!hover || !pos) return null;
  const reading = readingAt(readings, hover);
  return (
    <div className={styles.cursor} style={{ left: pos.x + 16, top: pos.y + 16 }} aria-hidden="true">
      {hover.x}, {hover.y}
      {reading && (
        <span className={styles.reading}>
          {" "}
          · {t("toast.detected", { count: reading.count })} · {formatRelative(reading.at, now)}
        </span>
      )}
    </div>
  );
}
