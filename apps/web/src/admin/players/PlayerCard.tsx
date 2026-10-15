import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { formatNumber, useTranslation } from "../../i18n";
import { type RouterOutputs, useTRPC } from "../../net/trpc";
import { Avatar, Button, Checkbox, ConfirmDialog, Field, IconButton, Input, Segmented, Tabs } from "../../ui/kit";
import styles from "../admin.module.css";
import {
  actionLabel,
  adminErrorText,
  BAN_PRESETS,
  type BanPresetKey,
  banUntil,
  describeAction,
  details,
  fmt,
  ITEMS,
  itemLabel,
  PERIOD_PRESETS,
  type PeriodId,
  parseDelta,
  presetRange,
  previewText,
  resultText,
} from "../format";
import { useSearchParam } from "../useSearchParam";

const REASON_MAX = 200;
const DAY_MS = 86_400_000;
const TABS = ["overview", "economy", "moderation", "history"] as const;
type CardTab = (typeof TABS)[number];
type Result = { ok: true; deleted?: number } | { ok: false; code: string };

/** Shared result handling: refresh what the action changed and say how it went. */
function useAdminMutation() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const refresh = () => {
    for (const key of [trpc.admin.players.get.pathKey(), trpc.admin.players.list.pathKey(), trpc.admin.modLog.pathKey()])
      void queryClient.invalidateQueries({ queryKey: key });
  };
  const handlers = (onDone: (res: Result & { ok: true }) => void) => ({
    onSuccess: (res: Result) => {
      if (res.ok) {
        setMessage({ text: t("admin.common.done"), error: false });
        onDone(res);
        refresh();
      } else setMessage({ text: adminErrorText(res.code), error: true });
    },
    onError: () => setMessage({ text: t("admin.common.failed"), error: true }),
  });
  return { message, setMessage, handlers };
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p className={message.error ? styles.error : styles.ok} role={message.error ? "alert" : "status"}>
      {message.text}
    </p>
  );
}

function ReasonField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}>{(c) => <Input {...c} value={value} maxLength={REASON_MAX} onChange={(e) => onChange(e.target.value)} />}</Field>;
}

const untilText = (until: number | "permanent" | null, t: ReturnType<typeof useTranslation>["t"]) =>
  until === "permanent" ? t("admin.common.forever") : t("admin.common.until", { at: fmt(until ?? 0) });

/** Right-hand card of one player: overview, economy, moderation, history. */
export function PlayerCard({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const player = useQuery(trpc.admin.players.get.queryOptions({ userId }));
  const [tabParam, setTab] = useSearchParam("cardTab");
  const tab: CardTab = TABS.find((x) => x === tabParam) ?? "overview";
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = player.data?.user.name ?? `#${userId}`;
  return (
    <aside ref={ref} className={styles.drawer} aria-label={name} tabIndex={-1}>
      <header className={styles.drawerHead}>
        <Avatar user={{ id: userId, name }} size={40} />
        <div className={styles.whoText} style={{ flex: 1 }}>
          <strong>{name}</strong>
          <span className={styles.whoSub}>#{userId}</span>
        </div>
        <IconButton icon="close" label={t("admin.card.close")} onClick={onClose} />
      </header>
      <div className={styles.drawerBody}>
        {player.isPending && <p className={styles.muted}>{t("common.loading")}</p>}
        {player.isError && <p className={styles.error}>{adminErrorText(undefined)}</p>}
        {player.data && (
          <Tabs
            label={t("admin.card.tabs")}
            value={tab}
            onChange={(v) => setTab(v === "overview" ? null : v)}
            tabs={TABS.map((id) => ({ id, label: t(`admin.card.${id}`) }))}
          >
            <div className={styles.form} style={{ paddingTop: 12 }}>
              {tab === "overview" && <Overview data={player.data} />}
              {tab === "economy" && <Economy userId={userId} data={player.data} />}
              {tab === "moderation" && <Moderation userId={userId} data={player.data} />}
              {tab === "history" && <History data={player.data} />}
            </div>
          </Tabs>
        )}
      </div>
    </aside>
  );
}

type PlayerData = RouterOutputs["admin"]["players"]["get"];

function isBanned(u: PlayerData["user"]): boolean {
  return u.bannedUntil === "permanent" || (u.bannedUntil !== null && u.bannedUntil > Date.now());
}
function isMuted(u: PlayerData["user"]): boolean {
  return u.chatMutedUntil === "permanent" || (u.chatMutedUntil !== null && u.chatMutedUntil > Date.now());
}

function Overview({ data }: { data: PlayerData }) {
  const { t } = useTranslation();
  const { user, state } = data;
  return (
    <>
      <dl className={styles.facts}>
        <dt>{t("admin.card.discordId")}</dt>
        <dd>{user.discordId}</dd>
        <dt>{t("admin.card.registered")}</dt>
        <dd>{fmt(user.createdAt)}</dd>
        <dt>{t("admin.card.discordCreated")}</dt>
        <dd>{fmt(user.discordCreatedAt)}</dd>
        <dt>{t("admin.card.lastSeen")}</dt>
        <dd>{user.lastSeenAt === null ? t("admin.common.never") : fmt(user.lastSeenAt)}</dd>
        <dt>{t("admin.card.guild")}</dt>
        <dd>{user.guildMember ? t("admin.common.yes") : t("admin.common.no")}</dd>
        <dt>{t("admin.card.status")}</dt>
        <dd>
          {isBanned(user) ? t("admin.card.bannedUntil", { until: untilText(user.bannedUntil, t) }) : t("admin.card.active")}
          {isBanned(user) && user.banReason && ` (${user.banReason})`}
        </dd>
        {isMuted(user) && (
          <>
            <dt>{t("admin.card.chat")}</dt>
            <dd>
              {t("admin.card.mutedUntil", { until: untilText(user.chatMutedUntil, t) })}
              {user.chatMuteReason && ` (${user.chatMuteReason})`}
            </dd>
          </>
        )}
      </dl>
      {state ? (
        <dl className={styles.facts}>
          <dt>{t("admin.card.territory")}</dt>
          <dd className={styles.num}>{formatNumber(state.territory)}</dd>
          <dt>{t("admin.card.activeBombs")}</dt>
          <dd className={styles.num}>{formatNumber(state.activeBombs)}</dd>
          <dt>{t("admin.card.charges")}</dt>
          <dd className={styles.num}>{state.unlimited ? "∞" : `${state.charges} / ${state.chargeCap}`}</dd>
          <dt>{t("admin.card.frozenUntil")}</dt>
          <dd>{state.frozenUntil > Date.now() ? fmt(state.frozenUntil) : t("admin.common.none")}</dd>
        </dl>
      ) : (
        <p className={styles.muted}>{t("admin.card.neverPlayed")}</p>
      )}
    </>
  );
}

function Economy({ userId, data }: { userId: number; data: PlayerData }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { message, handlers } = useAdminMutation();
  const [deltas, setDeltas] = useState<Record<(typeof ITEMS)[number], string>>({ coins: "", bomb: "", detector: "", defuser: "" });
  const [comment, setComment] = useState("");
  const adjust = useMutation({
    ...trpc.admin.players.adjust.mutationOptions(),
    ...handlers(() => {
      setDeltas({ coins: "", bomb: "", detector: "", defuser: "" });
      setComment("");
    }),
  });
  const state = data.state;
  if (!state) return <p className={styles.muted}>{t("admin.card.neverPlayed")}</p>;

  const parsed = ITEMS.map((k) => [k, parseDelta(deltas[k])] as const);
  const changes: Partial<Record<(typeof ITEMS)[number], number>> = {};
  for (const [k, v] of parsed) if (v) changes[k] = v;
  const canApply = !parsed.some(([, v]) => v === null) && Object.keys(changes).length > 0 && comment.trim().length > 0;
  const current = (k: (typeof ITEMS)[number]) => (state.unlimited ? "∞" : formatNumber(k === "coins" ? state.coins : state.inventory[k]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canApply && !adjust.isPending) adjust.mutate({ userId, changes, comment: comment.trim() });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <h3 className={styles.h2}>{t("admin.card.balance")}</h3>
      {ITEMS.map((k) => (
        <Field key={k} label={`${itemLabel(k)}: ${current(k)}`} error={parseDelta(deltas[k]) === null ? t("admin.card.deltaInvalid") : undefined}>
          {(c) => (
            <Input
              {...c}
              inputMode="numeric"
              placeholder={t("admin.card.deltaHint")}
              value={deltas[k]}
              onChange={(e) => setDeltas({ ...deltas, [k]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <ReasonField label={t("admin.common.comment")} value={comment} onChange={setComment} />
      <Button type="submit" variant="primary" disabled={!canApply || adjust.isPending}>
        {t("admin.card.adjust")}
      </Button>
      <Message message={message} />
    </form>
  );
}

function Moderation({ userId, data }: { userId: number; data: PlayerData }) {
  return (
    <>
      <BanBlock userId={userId} data={data} />
      <ChatBlock userId={userId} data={data} />
      <PixelRollback userId={userId} name={data.user.name} />
    </>
  );
}

function BanBlock({ userId, data }: { userId: number; data: PlayerData }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { message, setMessage, handlers } = useAdminMutation();
  const [preset, setPreset] = useState<BanPresetKey | "custom">("24h");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ban = useMutation({ ...trpc.admin.players.ban.mutationOptions(), ...handlers(() => setReason("")) });
  const unban = useMutation({ ...trpc.admin.players.unban.mutationOptions(), ...handlers(() => setReason("")) });
  const busy = ban.isPending || unban.isPending;

  if (isBanned(data.user)) {
    return (
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) unban.mutate({ userId, reason: reason.trim() });
        }}
      >
        <h3 className={styles.h2}>{t("admin.card.ban")}</h3>
        <p className={styles.muted}>{t("admin.card.bannedUntil", { until: untilText(data.user.bannedUntil, t) })}</p>
        <ReasonField label={t("admin.card.unbanReason")} value={reason} onChange={setReason} />
        <Button type="submit" disabled={busy || !reason.trim()}>
          {t("admin.card.unban")}
        </Button>
        <Message message={message} />
      </form>
    );
  }

  const doBan = () => {
    const until = banUntil(preset === "custom" ? { custom } : { preset }, Date.now());
    if (until === null) return setMessage({ text: adminErrorText("bad_until"), error: true });
    ban.mutate({ userId, until, reason: reason.trim() });
  };
  const label =
    preset === "forever"
      ? t("admin.card.banForever")
      : t("admin.card.banButton", { period: preset === "custom" ? custom || "…" : t(`admin.period.${preset}`) });
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim() || busy) return;
        if (preset === "forever") setConfirm(true);
        else doBan();
      }}
    >
      <h3 className={styles.h2}>{t("admin.card.ban")}</h3>
      <Segmented
        label={t("admin.card.banFor")}
        value={preset}
        onChange={setPreset}
        options={[
          ...BAN_PRESETS.map((p) => ({ value: p.key, label: t(`admin.period.${p.key}`) })),
          { value: "custom" as const, label: t("admin.common.custom") },
        ]}
      />
      {preset === "custom" && (
        <Field label={t("admin.common.customDate")}>
          {(c) => <Input {...c} type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        </Field>
      )}
      <ReasonField label={t("admin.common.reason")} value={reason} onChange={setReason} />
      <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
        {label}
      </Button>
      <Message message={message} />
      <ConfirmDialog
        open={confirm}
        title={t("admin.card.banConfirm", { name: data.user.name })}
        confirmLabel={t("admin.card.banForever")}
        danger
        busy={busy}
        onConfirm={() => {
          setConfirm(false);
          doBan();
        }}
        onCancel={() => setConfirm(false)}
      >
        {t("admin.card.banConfirmText")}
      </ConfirmDialog>
    </form>
  );
}

const MUTE_PRESETS = ["1h", "24h"] as const;

function ChatBlock({ userId, data }: { userId: number; data: PlayerData }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { message, setMessage, handlers } = useAdminMutation();
  const [preset, setPreset] = useState<(typeof MUTE_PRESETS)[number] | "custom">("1h");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const mute = useMutation({ ...trpc.admin.chat.mute.mutationOptions(), ...handlers(() => setReason("")) });
  const unmute = useMutation({ ...trpc.admin.chat.unmute.mutationOptions(), ...handlers(() => setReason("")) });
  const wipe = useMutation({
    ...trpc.admin.chat.deleteRecent.mutationOptions(),
    ...handlers((res) => setMessage({ text: t("admin.card.deleted", { n: res.deleted ?? 0 }), error: false })),
  });
  const busy = mute.isPending || unmute.isPending || wipe.isPending;
  const muted = isMuted(data.user);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    if (muted) return unmute.mutate({ userId, reason: reason.trim() });
    const until = banUntil(preset === "custom" ? { custom } : { preset }, Date.now());
    if (until === null) return setMessage({ text: adminErrorText("bad_until"), error: true });
    mute.mutate({ userId, until, reason: reason.trim() });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <h3 className={styles.h2}>{t("admin.card.chat")}</h3>
      {muted ? (
        <p className={styles.muted}>{t("admin.card.mutedUntil", { until: untilText(data.user.chatMutedUntil, t) })}</p>
      ) : (
        <>
          <Segmented
            label={t("admin.card.muteFor")}
            value={preset}
            onChange={setPreset}
            options={[...MUTE_PRESETS.map((p) => ({ value: p, label: t(`admin.period.${p}`) })), { value: "custom" as const, label: t("admin.common.custom") }]}
          />
          {preset === "custom" && (
            <Field label={t("admin.common.customDate")}>
              {(c) => <Input {...c} type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />}
            </Field>
          )}
        </>
      )}
      <ReasonField label={t("admin.common.reason")} value={reason} onChange={setReason} />
      <div className={styles.row}>
        <Button type="submit" variant={muted ? "secondary" : "danger"} disabled={busy || !reason.trim()}>
          {muted ? t("admin.card.unmute") : t("admin.card.mute")}
        </Button>
        <Button disabled={busy} onClick={() => wipe.mutate({ userId, periodMs: DAY_MS })}>
          {t("admin.card.deleteDay")}
        </Button>
      </div>
      <Message message={message} />
    </form>
  );
}

type PixelAction =
  | { kind: "rollback_player"; userId: number; from: number; to: number; area: null; removeBombs: boolean }
  | { kind: "remove_bombs"; userId: number };

/** Pixel rollback and bomb removal for one player: preview first, apply only what was previewed. */
function PixelRollback({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<PeriodId | "custom">("24h");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [removeBombs, setRemoveBombs] = useState(true);
  const [staged, setStaged] = useState<{ action: PixelAction; text: string; what: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  /** Bumped by every request and every change of its inputs; a late answer with an older token is dropped. */
  const token = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; a preview describes one exact action
  useEffect(() => {
    token.current++;
    setStaged(null);
    setMessage(null);
  }, [userId, period, from, to, removeBombs]);

  const preview = useMutation({
    mutationFn: ({ action }: { action: PixelAction; what: string; token: number }) =>
      queryClient.fetchQuery({ ...trpc.admin.moderation.preview.queryOptions({ action }), staleTime: 0 }),
    onSuccess: (res, req) => {
      if (req.token !== token.current) return;
      if (res.ok) setStaged({ action: req.action, text: previewText(res), what: req.what });
      else setMessage({ text: adminErrorText(res.code), error: true });
    },
    onError: (_e, req) => req.token === token.current && setMessage({ text: adminErrorText(undefined), error: true }),
  });
  const apply = useMutation({
    ...trpc.admin.moderation.execute.mutationOptions(),
    onSuccess: (res) => {
      setStaged(null);
      if (res.ok) {
        setMessage({ text: resultText(res), error: false });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.players.get.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.modLog.pathKey() });
      } else setMessage({ text: adminErrorText(res.code), error: true });
    },
    onError: () => {
      setStaged(null);
      setMessage({ text: adminErrorText(undefined), error: true });
    },
  });
  const busy = preview.isPending || apply.isPending;
  const preset = PERIOD_PRESETS.find((p) => p.id === period);
  const custom = { from: from ? new Date(from).getTime() : Number.NaN, to: to ? new Date(to).getTime() : Number.NaN };
  const ready = preset !== undefined || (Number.isFinite(custom.from) && Number.isFinite(custom.to) && custom.from <= custom.to);

  const calc = (action: PixelAction) => {
    setMessage(null);
    // The description is fixed now, from the same inputs as the action, so it always matches it.
    const what = describeAction(action, { player: name, ...(preset && action.kind === "rollback_player" ? { period: t(`admin.period.${preset.id}`) } : {}) });
    preview.mutate({ action, what, token: ++token.current });
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.h2}>{t("admin.card.rollback")}</h3>
      <Segmented
        label={t("admin.card.rollbackPeriod")}
        value={period}
        onChange={setPeriod}
        options={[
          ...PERIOD_PRESETS.map((p) => ({ value: p.id, label: t(`admin.period.${p.id}`) })),
          { value: "custom" as const, label: t("admin.common.custom") },
        ]}
      />
      {period === "custom" && (
        <div className={styles.row}>
          <Field label={t("admin.common.from")}>{(c) => <Input {...c} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t("admin.common.to")}>{(c) => <Input {...c} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
      )}
      <Checkbox label={t("admin.card.removeBombs")} checked={removeBombs} onChange={(e) => setRemoveBombs(e.target.checked)} />
      <p className={styles.muted}>{t("admin.card.rollbackNote")}</p>
      <div className={styles.row}>
        <Button
          disabled={busy || !ready}
          onClick={() => {
            // Preset ranges are taken at click time and sent as-is, so the applied action equals the previewed one.
            const range = preset ? presetRange(preset, Date.now()) : custom;
            calc({ kind: "rollback_player", userId, from: range.from, to: range.to, area: null, removeBombs });
          }}
        >
          {t("admin.common.preview")}
        </Button>
        <Button disabled={busy} onClick={() => calc({ kind: "remove_bombs", userId })}>
          {t("admin.card.removeAllBombs")}
        </Button>
      </div>
      {staged && (
        <div className={styles.staged} role="status">
          <p>{staged.what}</p>
          <p>{staged.text}</p>
          <div className={styles.row}>
            <Button variant="danger" disabled={busy} onClick={() => apply.mutate({ action: staged.action })}>
              {t("admin.common.apply")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStaged(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      <Message message={message} />
    </div>
  );
}

function History({ data }: { data: PlayerData }) {
  const { t } = useTranslation();
  if (data.log.length === 0) return <p className={styles.muted}>{t("admin.common.empty")}</p>;
  return (
    <ul className={styles.list}>
      {data.log.map((e) => (
        <li key={e.id}>
          <b>{actionLabel(e.action)}</b> · {e.admin.name} · <span className={styles.muted}>{fmt(e.at)}</span>
          <div className={styles.muted}>{details(e)}</div>
        </li>
      ))}
    </ul>
  );
}
