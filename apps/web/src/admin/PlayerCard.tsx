import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTRPC } from "../net/trpc";
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
