/** Why the engine refused a player action. The server returns these; the client translates them. */
export const REJECT_CODES = [
  "banned",
  "not_guild_member",
  "account_too_new",
  "frozen",
  "out_of_bounds",
  "invalid_color",
  "color_locked",
  "no_charges",
  "no_bombs",
  "bomb_limit",
  "no_detector",
  "no_defuser",
  "insufficient_coins",
  "boost_limit",
  "not_for_sale",
  "already_unlocked",
  "already_claimed",
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

/** Failures the client itself reports for an action: not logged in, no answer, transport limits. */
export const CLIENT_REJECT_CODES = ["unauthorized", "login_required", "unavailable", "timeout", "rate_limited"] as const;

/** Why a chat message was not sent. */
export const CHAT_SEND_CODES = ["chat_disabled", "empty", "too_long", "no_access", "muted", "cooldown"] as const;
export type ChatSendCode = (typeof CHAT_SEND_CODES)[number];
