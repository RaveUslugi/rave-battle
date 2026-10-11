import type { PlayerView } from "@rave/shared/client";

type Block = PlayerView["blocks"][number];

/** The first block still in force: a temporary ban or a too-new account may have expired since the view was built. */
export function effectiveAccess(p: Pick<PlayerView, "blocks" | "bannedUntil" | "playableAt">, now: number): Block | "ok" {
  const live = p.blocks.filter((b) => {
    if (b === "banned") return !(typeof p.bannedUntil === "number" && p.bannedUntil <= now);
    if (b === "account_too_new") return !(p.playableAt !== null && p.playableAt <= now);
    return true;
  });
  return live[0] ?? "ok";
}
