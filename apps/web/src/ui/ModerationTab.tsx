import { MAX_AREA_CELLS, rectCells, type Rect } from "@rave/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTRPC } from "../net/trpc";
import { useGame } from "../state/game-store";
import { uiStore, useUi } from "../state/ui-store";
import { describeAction, kindText, moderationErrorText, PERIOD_PRESETS, presetRange, previewText, rectText, resultText } from "./moderation-format";
import styles from "./Tabs.module.css";

const fmt = (ms: number) => new Date(ms).toLocaleString("ru-RU");

type Action =
  | { kind: "rollback_player"; userId: number; from: number; to: number; area: Rect | null; removeBombs: boolean }
  | { kind: "clear_area"; area: Rect; mode: "fill" }
  | { kind: "clear_area"; area: Rect; mode: "to_time"; at: number }
  | { kind: "remove_bombs"; area: Rect };

/** Admin side panel: cell inspector or area actions. Every call is checked on the server again. */
export function ModerationTab() {
  const cell = useUi((s) => s.moderation.cell);
  const area = useUi((s) => s.moderation.area);
  if (cell) return <Inspector cell={cell} />;
  if (area) return <AreaTools area={area} />;
  return (
    <div className={styles.tab}>
      <p className={styles.hint}>Выберите 🔎 клетку или ▭ область на холсте</p>
      <p className={styles.hint}>▭: протяните мышью, чтобы выделить; для перемещения холста выключите инструмент</p>
    </div>
  );
}

function Swatch({ colorId }: { colorId: number }) {
  const base = useGame((s) => s.config?.palette.find((e) => e.id === colorId)?.base);
  return <span className={styles.swatch} style={{ background: base ?? "transparent" }} role="img" aria-label={`Цвет ${colorId}`} />;
}

const playerLink = (user: { id: number; name: string }) => (
  <a className={styles.playerLink} href={`/admin?tab=players&player=${user.id}`} target="_blank" rel="noopener">
    {user.name}
  </a>
);

function Inspector({ cell }: { cell: { x: number; y: number } }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.admin.canvas.inspect.queryOptions({ cell }));
  if (query.isPending) return <p className={styles.hint}>Загрузка…</p>;
  if (query.isError)
    return (
      <div className={styles.tab}>
        <p className={styles.hint}>{moderationErrorText(undefined)}</p>
        <button type="button" className={styles.buy} onClick={() => void query.refetch()}>
          Повторить
        </button>
      </div>
    );
  const d = query.data;
  return (
    <div className={styles.tab}>
      <h3 className={styles.profileName}>
        ({d.x}, {d.y})
      </h3>
      <div className={styles.row}>
        <Swatch colorId={d.colorId} />
        <span>{d.owner ? playerLink(d.owner) : "Никто не рисовал"}</span>
      </div>
      <p className={styles.balance}>{d.bomb ? <>💣 Бомба игрока {playerLink(d.bomb.owner)} с {fmt(d.bomb.createdAt)}</> : "Бомбы нет"}</p>
      <h3 className={styles.section}>История</h3>
      {d.history.length === 0 ? (
        <p className={styles.hint}>Пусто</p>
      ) : (
        <ul className={styles.list}>
          {d.history.map((h, i) => (
            <li key={`${h.at}-${i}`} className={styles.row}>
              <span className={styles.hint}>{fmt(h.at)}</span>
              <span className={styles.name}>{h.user ? playerLink(h.user) : "—"}</span>
              <Swatch colorId={h.prevColorId} />→<Swatch colorId={h.colorId} />
              <span className={styles.hint}>{kindText(h.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Section = "clear" | "bombs" | "rollback";

const COORDS = ["x1", "y1", "x2", "y2"] as const;

function AreaTools({ area }: { area: Rect }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Record<(typeof COORDS)[number], string>>(() => toFields(area));
  const [clearMode, setClearMode] = useState<"fill" | "to_time">("fill");
  const [clearAt, setClearAt] = useState("");
  const [owner, setOwner] = useState<number | null>(null);
  const [period, setPeriod] = useState<string>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [removeBombs, setRemoveBombs] = useState(true);
  const [staged, setStaged] = useState<{ action: Action; text: string; what: string; section: Section } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // Selecting on the canvas replaces the typed values and any preview made for the old area.
  useEffect(() => {
    setFields(toFields(area));
    requestToken.current++;
    setStaged(null);
    setMessage(null);
  }, [area.x1, area.y1, area.x2, area.y2]);

  /** Bumped by every request and by every change of its inputs; a late answer with an older token is dropped. */
  const requestToken = useRef(0);
  // A preview describes one exact action: any change to what it depends on invalidates it.
  useEffect(() => {
    requestToken.current++;
    setStaged(null);
  }, [clearMode, clearAt, owner, period, customFrom, customTo, removeBombs]);
  useEffect(() => {
    setMessage(null);
  }, [clearMode, clearAt, period, customFrom, customTo, removeBombs]);

  const cells = rectCells(area);
  const tooLarge = cells > MAX_AREA_CELLS;
  const blocked = tooLarge || cells < 1;
  const owners = useQuery({ ...trpc.admin.canvas.areaOwners.queryOptions({ area }), enabled: !blocked });
  const ownerList = owners.data?.ok ? owners.data.owners : [];
  // The chosen player may vanish from the list (area change, refetch after an apply).
  useEffect(() => {
    if (owner !== null && owners.data && !ownerList.some((o) => o.user.id === owner)) setOwner(null);
  }, [owners.data, owner]);

  const edit = (key: (typeof COORDS)[number], value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    const nums = COORDS.map((k) => Number(next[k]));
    // Only a well-formed, ordered rectangle goes to the store (and the canvas frame) while typing.
    if (next.x1 && next.y1 && next.x2 && next.y2 && nums.every((n) => Number.isInteger(n) && n >= 0) && nums[0]! <= nums[2]! && nums[1]! <= nums[3]!) {
      uiStore.getState().setArea({ x1: nums[0]!, y1: nums[1]!, x2: nums[2]!, y2: nums[3]! });
    }
  };

  type Request = { action: Action; what: string; section: Section; token: number };
  const preview = useMutation({
    mutationFn: ({ action }: Request) => queryClient.fetchQuery({ ...trpc.admin.moderation.preview.queryOptions({ action }), staleTime: 0 }),
    onSuccess: (res, { action, what, section, token }) => {
      // The inputs changed while the request was in flight: this answer belongs to an action no longer on screen.
      if (token !== requestToken.current) return;
      if (res.ok) {
        setStaged({ action, text: previewText(res), what, section });
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
        void queryClient.invalidateQueries({ queryKey: trpc.admin.canvas.inspect.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.canvas.areaOwners.pathKey() });
      } else setMessage({ text: moderationErrorText(res.code), error: true });
    },
    onError: () => {
      setStaged(null);
      setMessage({ text: moderationErrorText(undefined), error: true });
    },
  });
  const busy = preview.isPending || apply.isPending;
  const calc = (action: Action, section: Section) => {
    setMessage(null);
    // The description is fixed now, from the same inputs as the action, so it always matches it.
    const player = action.kind === "rollback_player" ? ownerList.find((o) => o.user.id === action.userId)?.user.name : undefined;
    const label = PERIOD_PRESETS.find((p) => p.id === period)?.label;
    const what = describeAction(action, { fmt, ...(player ? { player } : {}), ...(label ? { period: label } : {}) });
    preview.mutate({ action, what, section, token: ++requestToken.current });
  };

  const clearTime = clearAt ? new Date(clearAt).getTime() : Number.NaN;
  const customRange = { from: customFrom ? new Date(customFrom).getTime() : Number.NaN, to: customTo ? new Date(customTo).getTime() : Number.NaN };
  const preset = PERIOD_PRESETS.find((p) => p.id === period);
  const rollbackReady = owner !== null && (preset !== undefined || (Number.isFinite(customRange.from) && Number.isFinite(customRange.to)));
  const calcRollback = () => {
    if (owner === null) return;
    // Preset ranges are taken at click time and sent as-is, so the applied action equals the previewed one.
    const range = preset ? presetRange(preset, Date.now()) : customRange;
    calc({ kind: "rollback_player", userId: owner, from: range.from, to: range.to, area, removeBombs }, "rollback");
  };

  const stagedBlock = (section: Section) =>
    staged?.section === section && (
        <div className={styles.notice} role="status">
          <p className={styles.balance}>{staged.what}</p>
          <p className={styles.balance}>{staged.text}</p>
          <div className={styles.segments}>
            <button type="button" className={styles.armed} disabled={busy} onClick={() => apply.mutate({ action: staged.action })}>
              Применить
            </button>
            <button type="button" className={styles.buy} disabled={busy} onClick={() => setStaged(null)}>
              Отмена
            </button>
          </div>
        </div>
      );

  return (
    <div className={styles.tab}>
      <h3 className={styles.profileName}>Область</h3>
      <div className={styles.coords}>
        {COORDS.map((k) => (
          <label key={k} className={styles.field}>
            {k}
            <input type="number" inputMode="numeric" min={0} className={styles.input} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />
          </label>
        ))}
      </div>
      <p className={styles.balance}>{rectText(area)}</p>
      {tooLarge && <p className={styles.notice}>Слишком большая область: не больше {MAX_AREA_CELLS} клеток</p>}

      <h3 className={styles.section}>Очистка</h3>
      <label className={styles.check}>
        <input type="radio" name="clear-mode" checked={clearMode === "fill"} onChange={() => setClearMode("fill")} /> Залить фоном
      </label>
      <label className={styles.check}>
        <input type="radio" name="clear-mode" checked={clearMode === "to_time"} onChange={() => setClearMode("to_time")} /> Откатить к моменту
      </label>
      {clearMode === "to_time" && <input type="datetime-local" className={styles.input} aria-label="Момент отката" value={clearAt} onChange={(e) => setClearAt(e.target.value)} />}
      <button
        type="button"
        className={styles.buy}
        disabled={blocked || busy || (clearMode === "to_time" && !Number.isFinite(clearTime))}
        onClick={() => calc(clearMode === "fill" ? { kind: "clear_area", area, mode: "fill" } : { kind: "clear_area", area, mode: "to_time", at: clearTime }, "clear")}
      >
        Посчитать
      </button>
      {stagedBlock("clear")}

      <h3 className={styles.section}>Бомбы</h3>
      <button type="button" className={styles.buy} disabled={blocked || busy} onClick={() => calc({ kind: "remove_bombs", area }, "bombs")}>
        Посчитать снятие бомб в области
      </button>
      {stagedBlock("bombs")}

      <h3 className={styles.section}>Откат игрока в области</h3>
      {owners.isPending && !blocked ? (
        <p className={styles.hint}>Загрузка…</p>
      ) : ownerList.length === 0 ? (
        <p className={styles.hint}>В области нет пикселей игроков</p>
      ) : (
        <ul className={styles.list} role="radiogroup" aria-label="Игрок">
          {ownerList.map((o) => (
            <li key={o.user.id}>
              <label className={styles.check}>
                <input type="radio" name="rollback-owner" checked={owner === o.user.id} onChange={() => {
                    setOwner(o.user.id);
                    setMessage(null);
                  }} />
                <span className={styles.name}>{o.user.name}</span>
                <span className={styles.hint}>{o.cells}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.segments} role="group" aria-label="Период">
        {PERIOD_PRESETS.map((p) => (
          <button key={p.id} type="button" className={period === p.id ? styles.segmentOn : styles.segment} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className={period === "custom" ? styles.segmentOn : styles.segment} aria-pressed={period === "custom"} onClick={() => setPeriod("custom")}>
          своё
        </button>
      </div>
      {period === "custom" && (
        <div className={styles.coords}>
          <label className={styles.field}>
            с
            <input type="datetime-local" className={styles.input} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label className={styles.field}>
            по
            <input type="datetime-local" className={styles.input} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      <label className={styles.check}>
        <input type="checkbox" checked={removeBombs} onChange={(e) => setRemoveBombs(e.target.checked)} /> Также снять все бомбы игрока в области
      </label>
      <button
        type="button"
        className={styles.buy}
        disabled={blocked || busy || !rollbackReady}
        onClick={calcRollback}
      >
        Посчитать
      </button>
      {stagedBlock("rollback")}
      <p className={styles.hint}>Для рейда нескольких игроков надёжнее «Очистка → Откатить к моменту»: откат игрока не трогает клетки, восстановленные прошлой модерацией.</p>

      {message && (
        <p className={message.error ? styles.notice : styles.balance} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function toFields(a: Rect) {
  return { x1: String(a.x1), y1: String(a.y1), x2: String(a.x2), y2: String(a.y2) };
}
