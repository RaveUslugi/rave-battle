import type { FeedMessage, UserRef } from "@rave/shared/client";
import type { IconName } from "../../kit";
import { i18n } from "../../../i18n";

export type FeedPart = string | UserRef;

/**
 * Text of a feed event, split into plain strings and player references (clickable names). The
 * translation keeps `{{actor}}` / `{{owner}}` as placeholders, so word order follows the language.
 */
export function feedParts(e: FeedMessage): FeedPart[] {
  const own = e.actor.id === e.owner.id;
  const key = e.kind === "exploded" ? (own ? "feed.explodedSelf" : "feed.exploded") : own ? "feed.defusedSelf" : "feed.defused";
  const template = i18n.t(key, { actor: "{{actor}}", owner: "{{owner}}", interpolation: { skipOnVariables: true } });
  const users: Record<string, UserRef> = { actor: e.actor, owner: e.owner };
  return template
    .split(/(\{\{actor\}\}|\{\{owner\}\})/)
    .filter((part) => part !== "")
    .map((part) => users[part.slice(2, -2)] ?? part);
}

export function feedText(e: FeedMessage): string {
  return feedParts(e)
    .map((p) => (typeof p === "string" ? p : p.name))
    .join("");
}

/** Explosions red, self-explosions gold, defuses lime. */
export function feedIcon(e: FeedMessage): { icon: IconName; tone: "red" | "gold" | "lime" } {
  if (e.kind === "defused") return { icon: "defuser", tone: "lime" };
  return { icon: "boom", tone: e.actor.id === e.owner.id ? "gold" : "red" };
}

/** Close enough to the bottom to keep following new messages. */
export const BOTTOM_SLACK_PX = 24;

export function isAtBottom(el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
}
