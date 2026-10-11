import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTRPC } from "../net/trpc";
import { describeAction, moderationErrorText, PERIOD_PRESETS, presetRange, previewText, resultText } from "../ui/moderation-format";
import { BAN_PRESETS, banUntil, parseDelta, type BanPresetKey } from "./ban";
import { ACTION_LABEL, ITEM_LABEL, adminErrorText } from "./labels";
import styles from "./admin.module.css";

const FAILED = "Не удалось выполнить действие";
const REASON_MAX = 200;
const fmt = (ms: number) => new Date(ms).toLocaleString("ru-RU");
const DELTA_KEYS = ["coins", "bomb", "detector", "defuser"] as const;

type Result = { ok: true } | { ok: false; code: string };

export function PlayerCard({ userId }: { userId: number }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const player = useQuery(trpc.admin.players.get.queryOptions({ userId }));

  const [toast, setToast] = useState<string | null>(null);
  const [banError, setBanError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [preset, setPreset] = useState<BanPresetKey | "custom">("24h");
  const [custom, setCustom] = useState("");
  const [banReason, setBanReason] = useState("");
  const [unbanReason, setUnbanReason] = useState("");
  const [deltas, setDeltas] = useState({ coins: "", bomb: "", detector: "", defuser: "" });
  const [comment, setComment] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.admin.players.get.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.admin.players.search.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.admin.modLog.pathKey() });
  };
  const handle = (setError: (e: string | null) => void, onDone: () => void) => ({
    onSuccess: (res: Result) => {
      if (res.ok) {
        setError(null);
        setToast("Готово");
        onDone();
        refresh();
      } else {
        setToast(null);
        setError(adminErrorText(res.code));
      }
    },
    onError: () => {
      setToast(null);
      setError(FAILED);
    },
  });

  const ban = useMutation({
    ...trpc.admin.players.ban.mutationOptions(),
    ...handle(setBanError, () => {
      setBanReason("");
      setCustom("");
    }),
  });
  const unban = useMutation({ ...trpc.admin.players.unban.mutationOptions(), ...handle(setBanError, () => setUnbanReason("")) });
  const adjust = useMutation({
    ...trpc.admin.players.adjust.mutationOptions(),
    ...handle(setEditError, () => {
      setDeltas({ coins: "", bomb: "", detector: "", defuser: "" });
      setComment("");
    }),
  });

  if (player.isPending) return <p className={styles.message}>Загрузка…</p>;
  if (player.isError) return <p className={styles.error}>Не удалось загрузить игрока</p>;
  const { user, state, log } = player.data;
  const busy = ban.isPending || unban.isPending || adjust.isPending;
  const banned = user.bannedUntil === "permanent" || (user.bannedUntil !== null && user.bannedUntil > Date.now());

  const submitBan = (e: FormEvent) => {
    e.preventDefault();
    setToast(null);
    const until = banUntil(preset === "custom" ? { custom } : { preset }, Date.now());
    if (until === null) return setBanError(adminErrorText("bad_until"));
    setBanError(null);
    ban.mutate({ userId, until, reason: banReason.trim() });
  };
  const submitUnban = (e: FormEvent) => {
    e.preventDefault();
    setToast(null);
    setBanError(null);
    unban.mutate({ userId, reason: unbanReason.trim() });
  };

  const parsed = DELTA_KEYS.map((k) => [k, parseDelta(deltas[k])] as const);
  const invalid = parsed.some(([, v]) => v === null);
  const changes: Partial<Record<(typeof DELTA_KEYS)[number], number>> = {};
  for (const [k, v] of parsed) if (v) changes[k] = v;
  const canApply = !invalid && Object.keys(changes).length > 0 && comment.trim().length > 0;
  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!canApply) return;
    setToast(null);
    setEditError(null);
    adjust.mutate({ userId, changes, comment: comment.trim() });
  };

  return (
    <article className={styles.card}>
      <h2 className={styles.cardTitle}>
        {user.name} <span className={styles.muted}>#{user.id}</span>
      </h2>
      <dl className={styles.facts}>
        <dt>Discord ID</dt>
        <dd>{user.discordId}</dd>
        <dt>Регистрация</dt>
        <dd>{fmt(user.createdAt)}</dd>
        <dt>Discord-аккаунт</dt>
        <dd>{fmt(user.discordCreatedAt)}</dd>
        <dt>Последний вход</dt>
        <dd>{user.lastSeenAt === null ? "—" : fmt(user.lastSeenAt)}</dd>
        <dt>Гильдия</dt>
        <dd>{user.guildMember ? "да" : "нет"}</dd>
        <dt>Статус</dt>
        <dd>
          {banned
            ? `заблокирован ${user.bannedUntil === "permanent" ? "навсегда" : `до ${fmt(user.bannedUntil as number)}`}${user.banReason ? ` (${user.banReason})` : ""}`
            : "активен"}
        </dd>
      </dl>
      {toast && <p className={styles.toast} role="status">{toast}</p>}

      <h3 className={styles.subtitle}>Состояние</h3>
      {state ? (
        <dl className={styles.facts}>
          <dt>Монеты</dt>
          <dd>{state.unlimited ? "∞" : state.coins}</dd>
          <dt>{ITEM_LABEL.bomb}</dt>
          <dd>{state.unlimited ? "∞" : state.inventory.bomb}</dd>
          <dt>{ITEM_LABEL.detector}</dt>
          <dd>{state.unlimited ? "∞" : state.inventory.detector}</dd>
          <dt>{ITEM_LABEL.defuser}</dt>
          <dd>{state.unlimited ? "∞" : state.inventory.defuser}</dd>
          <dt>Заряды</dt>
          <dd>{state.unlimited ? "∞" : `${state.charges} / ${state.chargeCap}`}</dd>
          <dt>Заморожен до</dt>
          <dd>{state.frozenUntil > Date.now() ? fmt(state.frozenUntil) : "—"}</dd>
          <dt>Активных бомб</dt>
          <dd>{state.activeBombs}</dd>
          <dt>Территория</dt>
          <dd>{state.territory}</dd>
        </dl>
      ) : (
        <p className={styles.message}>Ещё не заходил в игру — правка недоступна</p>
      )}

      <h3 className={styles.subtitle}>Блокировка</h3>
      {banned ? (
        <form className={styles.form} onSubmit={submitUnban}>
          <label className={styles.field}>
            Причина разбана
            <input className={styles.input} value={unbanReason} maxLength={REASON_MAX} onChange={(e) => setUnbanReason(e.target.value)} />
          </label>
          <button type="submit" className={styles.button} disabled={busy || unbanReason.trim().length === 0}>
            Разблокировать
          </button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={submitBan}>
          <div className={styles.radios} role="radiogroup" aria-label="Срок блокировки">
            {BAN_PRESETS.map((p) => (
              <label key={p.key} className={styles.radio}>
                <input type="radio" name="ban-preset" checked={preset === p.key} onChange={() => setPreset(p.key)} /> {p.label}
              </label>
            ))}
            <label className={styles.radio}>
              <input type="radio" name="ban-preset" checked={preset === "custom"} onChange={() => setPreset("custom")} /> Своя дата
            </label>
          </div>
          {preset === "custom" && (
            <input className={styles.input} type="datetime-local" aria-label="Своя дата" value={custom} onChange={(e) => setCustom(e.target.value)} />
          )}
          <label className={styles.field}>
            Причина
            <input className={styles.input} value={banReason} maxLength={REASON_MAX} onChange={(e) => setBanReason(e.target.value)} />
          </label>
          <button type="submit" className={styles.button} disabled={busy || banReason.trim().length === 0}>
            Заблокировать
          </button>
        </form>
      )}
      {banError && <p className={styles.error}>{banError}</p>}

      {state && (
        <>
          <h3 className={styles.subtitle}>Правка баланса</h3>
          <form className={styles.form} onSubmit={submitEdit}>
            <div className={styles.deltas}>
              {DELTA_KEYS.map((k) => (
                <label key={k} className={styles.field}>
                  {ITEM_LABEL[k]}
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    placeholder="+N или −N"
                    value={deltas[k]}
                    aria-invalid={parseDelta(deltas[k]) === null}
                    onChange={(e) => setDeltas({ ...deltas, [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className={styles.field}>
              Комментарий
              <input className={styles.input} value={comment} maxLength={REASON_MAX} onChange={(e) => setComment(e.target.value)} />
            </label>
            <button type="submit" className={styles.button} disabled={busy || !canApply}>
              Применить
            </button>
          </form>
          {editError && <p className={styles.error}>{editError}</p>}
        </>
      )}

      <PixelRollback userId={userId} name={user.name} />

      <h3 className={styles.subtitle}>История модерации игрока</h3>
      {log.length === 0 ? (
        <p className={styles.message}>Записей нет</p>
      ) : (
        <ul className={styles.log}>
          {log.map((e) => (
            <li key={e.id}>
              {fmt(e.at)} · {ACTION_LABEL[e.action]} · {e.admin.name}
              {typeof e.params.reason === "string" && ` · ${e.params.reason}`}
              {typeof e.params.comment === "string" && ` · ${e.params.comment}`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

type PixelAction =
  | { kind: "rollback_player"; userId: number; from: number; to: number; area: null; removeBombs: boolean }
  | { kind: "remove_bombs"; userId: number };

/** Pixel rollback and bomb removal for one player: preview first, apply only what was previewed. */
function PixelRollback({ userId, name }: { userId: number; name: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<string>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [removeBombs, setRemoveBombs] = useState(true);
  const [staged, setStaged] = useState<{ action: PixelAction; text: string; what: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  /** Bumped by every request and by every change of its inputs; a late answer with an older token is dropped. */
  const requestToken = useRef(0);
  // A preview describes one exact action: any change to what it depends on invalidates it.
  useEffect(() => {
    requestToken.current++;
    setStaged(null);
    setMessage(null);
  }, [userId, period, customFrom, customTo, removeBombs]);

  type Request = { action: PixelAction; what: string; token: number };
  const preview = useMutation({
    mutationFn: ({ action }: Request) => queryClient.fetchQuery({ ...trpc.admin.moderation.preview.queryOptions({ action }), staleTime: 0 }),
    onSuccess: (res, { action, what, token }) => {
      if (token !== requestToken.current) return;
      if (res.ok) {
        setStaged({ action, text: previewText(res), what });
        setMessage(null);
      } else {
        setStaged(null);
        setMessage({ text: moderationErrorText(res.code), error: true });
      }
    },
    onError: (_error, { token }) => {
      if (token !== requestToken.current) return;
      setStaged(null);
      setMessage({ text: moderationErrorText(undefined), error: true });
    },
  });
  const apply = useMutation({
    ...trpc.admin.moderation.execute.mutationOptions(),
    onSuccess: (res) => {
      setStaged(null);
      if (res.ok) {
        setMessage({ text: resultText(res), error: false });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.players.get.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.modLog.pathKey() });
      } else setMessage({ text: moderationErrorText(res.code), error: true });
    },
    onError: () => {
      setStaged(null);
      setMessage({ text: moderationErrorText(undefined), error: true });
    },
  });
  const busy = preview.isPending || apply.isPending;

  const preset = PERIOD_PRESETS.find((p) => p.id === period);
  const custom = { from: customFrom ? new Date(customFrom).getTime() : Number.NaN, to: customTo ? new Date(customTo).getTime() : Number.NaN };
  const rollbackReady = preset !== undefined || (Number.isFinite(custom.from) && Number.isFinite(custom.to) && custom.from <= custom.to);

  const calc = (action: PixelAction) => {
    setMessage(null);
    // The description is fixed now, from the same inputs as the action, so it always matches it.
    const what = describeAction(action, { fmt, player: name, ...(preset && action.kind === "rollback_player" ? { period: preset.label } : {}) });
    preview.mutate({ action, what, token: ++requestToken.current });
  };
  const calcRollback = () => {
    // Preset ranges are taken at click time and sent as-is, so the applied action equals the previewed one.
    const range = preset ? presetRange(preset, Date.now()) : custom;
    calc({ kind: "rollback_player", userId, from: range.from, to: range.to, area: null, removeBombs });
  };

  return (
    <>
      <h3 className={styles.subtitle}>Откат пикселей</h3>
      <div className={styles.form}>
        <div className={styles.radios} role="radiogroup" aria-label="Период отката">
          {PERIOD_PRESETS.map((p) => (
            <label key={p.id} className={styles.radio}>
              <input type="radio" name="rollback-period" checked={period === p.id} onChange={() => setPeriod(p.id)} /> {p.label}
            </label>
          ))}
          <label className={styles.radio}>
            <input type="radio" name="rollback-period" checked={period === "custom"} onChange={() => setPeriod("custom")} /> Своё
          </label>
        </div>
        {period === "custom" && (
          <>
            <label className={styles.field}>
              с
              <input className={styles.input} type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label className={styles.field}>
              по
              <input className={styles.input} type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </>
        )}
        <label className={styles.radio}>
          <input type="checkbox" checked={removeBombs} onChange={(e) => setRemoveBombs(e.target.checked)} /> Также снять все бомбы игрока
        </label>
        <div className={styles.radios}>
          <button type="button" className={styles.button} disabled={busy || !rollbackReady} onClick={calcRollback}>
            Посчитать
          </button>
          <button type="button" className={styles.button} disabled={busy} onClick={() => calc({ kind: "remove_bombs", userId })}>
            Снять все бомбы игрока
          </button>
        </div>
      </div>
      {staged && (
        <div className={styles.staged} role="status">
          <p>{staged.what}</p>
          <p>{staged.text}</p>
          <div className={styles.radios}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => apply.mutate({ action: staged.action })}>
              Применить
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={() => setStaged(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.error ? styles.error : styles.toast} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </>
  );
}
