import type { PlayerView } from "@rave/shared/client";
import { effectiveAccess } from "../game/access";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import styles from "./AccessBanner.module.css";

const formatDate = (ms: number) => new Date(ms).toLocaleString("ru-RU");

function bannedText(player: PlayerView): string {
  const until = player.bannedUntil === "permanent" || player.bannedUntil === null ? "навсегда" : `до ${formatDate(player.bannedUntil)}`;
  const reason = player.banReason ? `. Причина: ${player.banReason}` : "";
  return `Вы заблокированы ${until}${reason} — можно только смотреть`;
}

/** Why the player cannot play. Several blocks can hold at once: the most important one is shown. */
export function AccessBanner() {
  const player = useGame((s) => s.player);
  const now = useServerNow(1000);
  if (!player) return null;
  const access = effectiveAccess(player, now);
  if (access === "ok") return null;
  const text =
    access === "banned"
      ? bannedText(player)
      : access === "not_guild_member"
        ? "Играть могут только участники сообщества — можно только смотреть"
        : `Аккаунт Discord слишком новый — играть можно с ${player.playableAt === null ? "…" : formatDate(player.playableAt)}`;
  return (
    <div className={styles.banner} role="status">
      {text}
    </div>
  );
}
