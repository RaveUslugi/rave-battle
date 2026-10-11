import type { ServerConfig } from "../net/env";
import { DEV_ADMIN_DISCORD_ID } from "./dev-admin";

/** Admin rights come only from the server config; the client flag is for showing links. */
export function isAdmin(discordId: string, config: Pick<ServerConfig, "adminDiscordIds" | "devLogin">): boolean {
  return config.adminDiscordIds.has(discordId) || (config.devLogin && discordId === DEV_ADMIN_DISCORD_ID);
}
