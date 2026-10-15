import type { ChatMessage, FeedMessage } from "@rave/shared/client";
import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { effectiveAccess } from "../../../game/access";
import { rejectText } from "../../../game/messages";
import { useServerNow } from "../../../hooks/useNow";
import { currentLocale, i18n, useTranslation } from "../../../i18n";
import { type ChatAnswer, chatApi } from "../../../net/api";
import { useGame } from "../../../state/game-store";
import { type TimelineItem, timelineStore, useTimeline } from "../../../state/timeline-store";
import { uiStore, useUi } from "../../../state/ui-store";
import { Avatar, Icon } from "../../kit";
import styles from "./chat.module.css";
import { feedIcon, feedParts, isAtBottom } from "./feed-text";

const time = (at: number) => new Date(at).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
const openProfile = (id: number) => uiStore.getState().openProfile(id);

function MessageItem({ m, mine, admin, avatar }: { m: ChatMessage; mine: boolean; admin: boolean; avatar: number }) {
  const { t } = useTranslation();
  const remove = async () => {
    const answer = await chatApi.remove(m.id);
    if (!answer.ok) uiStore.getState().pushToast("error", t("chat.deleteFailed"));
  };
  return (
    <li className={styles.message}>
      <Avatar user={m.author} size={avatar} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <button type="button" className={styles.author} data-mine={mine || undefined} onClick={() => openProfile(m.author.id)}>
            {m.author.name}
          </button>
          <time className={styles.time} dateTime={new Date(m.at).toISOString()}>
            {time(m.at)}
          </time>
          {admin && (
            <button type="button" className={styles.delete} aria-label={`${t("chat.delete")}: ${m.author.name}, ${time(m.at)}`} onClick={() => void remove()}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <p className={styles.text}>{m.text}</p>
      </div>
    </li>
  );
}

function EventItem({ e }: { e: FeedMessage }) {
  const { icon, tone } = feedIcon(e);
  return (
    <li className={styles.event}>
      <span className={styles.eventIcon} data-tone={tone}>
        <Icon name={icon} size={12} />
      </span>
      <span>
        {feedParts(e).map((part, i) =>
          typeof part === "string" ? (
            part
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed sentence
            <button key={i} type="button" className={styles.eventName} onClick={() => openProfile(part.id)}>
              {part.name}
            </button>
          ),
        )}
      </span>
    </li>
  );
}

/**
 * Messages and game events, oldest at the top. Follows new entries while scrolled to the bottom;
 * scrolled up, it stays put and offers "N new ↓". `active`: the feed is on screen (not folded or hidden).
 */
export function ChatFeed({ active, avatar = 20 }: { active: boolean; avatar?: number }) {
  const { t } = useTranslation();
  const items = useTimeline((s) => s.items);
  const showEvents = useTimeline((s) => s.showEvents);
  const me = useGame((s) => s.user?.id ?? null);
  const admin = useGame((s) => s.admin);
  const list = useRef<HTMLOListElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [fresh, setFresh] = useState(0);
  const lastKey = useRef<string | null>(null);
  const shown = showEvents ? items : items.filter((i) => i.type === "chat");

  // New entries: follow them at the bottom, otherwise count them for the "N new" button.
  useLayoutEffect(() => {
    const el = list.current;
    const last = shown.at(-1)?.key ?? null;
    const before = lastKey.current;
    lastKey.current = last;
    if (!el || last === before) return;
    if (atBottom || before === null) el.scrollTop = el.scrollHeight;
    else setFresh((n) => n + newSince(shown, before));
  }, [shown, atBottom]);

  // Unread messages are cleared while the bottom of an active feed is on screen.
  useEffect(() => {
    timelineStore.getState().setViewing(active && atBottom);
    return () => timelineStore.getState().setViewing(false);
  }, [active, atBottom]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const bottom = isAtBottom(el);
    setAtBottom(bottom);
    if (bottom) setFresh(0);
  };

  const toBottom = () => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setFresh(0);
  };

  return (
    <div className={styles.feedWrap}>
      <ol ref={list} className={styles.feed} aria-live="polite" onScroll={onScroll}>
        {shown.length === 0 && <li className={styles.empty}>{t("chat.quiet")}</li>}
        {shown.map((item) =>
          item.type === "chat" ? (
            <MessageItem key={item.key} m={item} mine={item.author.id === me} admin={admin} avatar={avatar} />
          ) : (
            <EventItem key={item.key} e={item} />
          ),
        )}
      </ol>
      {!atBottom && fresh > 0 && (
        <button type="button" className={styles.fresh} onClick={toBottom}>
          {t("chat.newBelow", { n: fresh })}
          <Icon name="chevronDown" size={12} />
        </button>
      )}
    </div>
  );
}

/** How many entries came after the one with key `before`; 0 when it is gone (events hidden, history replaced). */
function newSince(items: TimelineItem[], before: string): number {
  const at = items.findIndex((i) => i.key === before);
  return at === -1 ? 0 : items.length - 1 - at;
}

export function EventsToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const on = useTimeline((s) => s.showEvents);
  return (
    <button
      type="button"
      className={styles.eventsToggle}
      data-compact={compact || undefined}
      aria-pressed={on}
      aria-label={compact ? t("chat.showEvents") : undefined}
      title={t("chat.showEvents")}
      onClick={() => timelineStore.getState().setShowEvents(!on)}
    >
      <Icon name="boom" size={compact ? 16 : 12} />
      {!compact && t("chat.events")}
    </button>
  );
}

/** Why this player may not write right now; null = may write. */
function useWriteBlock(): string | null {
  const { t } = useTranslation();
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(1000);
  if (config && !config.chat.enabled) return t("chat.chat_disabled");
  if (!player) return null;
  const access = effectiveAccess(player, now);
  if (access !== "ok") return rejectText(access);
  const until = player.chatMutedUntil;
  if (until === "permanent" || (typeof until === "number" && until > now)) {
    const text = until === "permanent" ? t("chat.muted_permanent") : t("chat.muted", { until: new Date(until).toLocaleString(currentLocale()) });
    return player.chatMuteReason ? `${text}. ${t("state.reason", { reason: player.chatMuteReason })}` : text;
  }
  return null;
}

export function sendErrorText(answer: Exclude<ChatAnswer, { ok: true }>, serverNow: number): string {
  if (answer.code === "cooldown") return i18n.t("chat.cooldown", { seconds: Math.max(1, Math.ceil((answer.retryAt - serverNow) / 1000)) });
  if (answer.code === "muted")
    return answer.until === "permanent"
      ? i18n.t("chat.muted_permanent")
      : i18n.t("chat.muted", { until: new Date(answer.until).toLocaleString(currentLocale()) });
  if (answer.code === "unauthorized" || answer.code === "rate_limited" || answer.code === "unavailable") return rejectText(answer.code);
  return i18n.t(`chat.${answer.code}`);
}

/** The message field: Enter or the button sends; errors stay under the field and the text is kept. */
export function ChatComposer({ withToggle = false, big = false }: { withToggle?: boolean; big?: boolean }) {
  const { t } = useTranslation();
  const user = useGame((s) => s.user);
  const maxLength = useGame((s) => s.config?.chat.maxLength ?? 200);
  const offset = useGame((s) => s.clockOffset);
  const blocked = useWriteBlock();
  const field = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const errorId = useId();

  if (!user || blocked) {
    return (
      <div className={styles.composer} data-big={big || undefined}>
        {withToggle && <EventsToggle compact />}
        {user ? <p className={styles.blocked}>{blocked}</p> : <GuestNote />}
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = field.current;
    if (sending || !input || input.value.trim() === "") return;
    setSending(true);
    const answer = await chatApi.send(input.value);
    setSending(false);
    if (answer.ok) {
      input.value = "";
      setError(null);
    } else setError(sendErrorText(answer, Date.now() + offset));
  };

  return (
    <form className={styles.composer} data-big={big || undefined} onSubmit={(e) => void submit(e)}>
      <div className={styles.composerRow}>
        {withToggle && <EventsToggle compact />}
        <input
          ref={field}
          className={styles.input}
          maxLength={maxLength}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.label")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          enterKeyHint="send"
          autoComplete="off"
          onInput={() => error && setError(null)}
        />
        <button type="submit" className={styles.send} aria-label={t("chat.send")} aria-busy={sending || undefined}>
          <Icon name="send" />
        </button>
      </div>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function GuestNote() {
  const { t } = useTranslation();
  return (
    <div className={styles.guest}>
      <span>{t("chat.guest")}</span>
    </div>
  );
}

/** Desktop: a block at the bottom left that folds down to its header (with the unread count). */
export function ChatBlock() {
  const { t } = useTranslation();
  const collapsed = useUi((s) => s.chatCollapsed);
  const unread = useTimeline((s) => s.unread);
  return (
    <section className={styles.block} data-collapsed={collapsed || undefined} aria-label={t("chat.region")}>
      <header className={styles.head}>
        <span className={styles.live} aria-hidden="true" />
        <h2 className={styles.title}>{t("chat.title")}</h2>
        {collapsed && unread > 0 && <span className={styles.unread}>{t("chat.newBelow", { n: unread })}</span>}
        {!collapsed && <EventsToggle />}
        <button
          type="button"
          className={styles.fold}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("chat.expand") : t("chat.collapse")}
          onClick={() => uiStore.getState().setChatCollapsed(!collapsed)}
        >
          <Icon name="chevronDown" size={12} />
        </button>
      </header>
      {!collapsed && (
        <>
          <ChatFeed active />
          <ChatComposer />
        </>
      )}
    </section>
  );
}

function lastMessage(items: TimelineItem[]): ChatMessage | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.type === "chat") return item;
  }
  return null;
}

/** Phone: the latest message and the unread count over the canvas; a tap opens the chat. */
export function ChatTicker() {
  const { t } = useTranslation();
  const last = useTimeline((s) => lastMessage(s.items));
  const unread = useTimeline((s) => s.unread);
  return (
    <button
      type="button"
      className={styles.ticker}
      aria-label={unread > 0 ? t("chat.openUnread", { n: unread }) : t("chat.open")}
      onClick={() => uiStore.getState().openPanel("chat")}
    >
      <Icon name="chat" className={styles.tickerIcon} />
      <span className={styles.tickerText} aria-hidden="true">
        {last ? (
          <>
            <b>{last.author.name}:</b> {last.text}
          </>
        ) : (
          t("chat.title")
        )}
      </span>
      {unread > 0 && (
        <span className={styles.tickerCount} aria-hidden="true">
          {unread}
        </span>
      )}
    </button>
  );
}

/** Phone: the chat tab of the sheet; the field sits at the bottom, above the keyboard. */
export function ChatSection() {
  return (
    <div className={styles.section}>
      <ChatFeed active avatar={28} />
      <ChatComposer withToggle big />
    </div>
  );
}
