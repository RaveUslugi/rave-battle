import type { PlayerView } from "@rave/shared/client";

/** `access` is a snapshot from the server: a temporary ban or a too-new account may have expired since. */
export function effectiveAccess(p: Pick<PlayerView, "access" | "bannedUntil" | "playableAt">, now: number): PlayerView["access"] {
  if (p.access === "banned" && typeof p.bannedUntil === "number" && p.bannedUntil <= now) return "ok";
  if (p.access === "account_too_new" && p.playableAt !== null && p.playableAt <= now) return "ok";
  return p.access;
}
