import { MAX_AREA_CELLS, type Rect, rectCells } from "@rave/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatNumber, useTranslation } from "../../i18n";
import { useTRPC } from "../../net/trpc";
import { useGame } from "../../state/game-store";
import { uiStore, useUi } from "../../state/ui-store";
import { Button, ConfirmDialog, Field, Input, Tabs } from "../../ui/kit";
import styles from "../admin.module.css";
import { adminErrorText, cellsText, describeAction, fmt, kindText, previewText, rectText, resultText } from "../format";
import { openPlayer } from "../LogPage";
import c from "./canvas.module.css";

type Action =
  | { kind: "clear_area"; area: Rect; mode: "fill" }
  | { kind: "clear_area"; area: Rect; mode: "to_time"; at: number }
  | { kind: "remove_bombs"; area: Rect };
type Mode = "to_time" | "fill" | "bombs";
const COORDS = ["x1", "y1", "x2", "y2"] as const;

function Swatch({ colorId }: { colorId: number }) {
  const { t } = useTranslation();
  const base = useGame((s) => s.config?.palette.find((e) => e.id === colorId)?.base);
  return <span className={c.swatch} style={{ background: base ?? "transparent" }} role="img" aria-label={t("kit.colorN", { id: colorId })} />;
}

function PlayerLink({ user }: { user: { id: number; name: string } }) {
  return (
    <button type="button" className={styles.linkButton} onClick={() => openPlayer(user.id)}>
      {user.name}
    </button>
  );
}

/** The canvas page's right panel: what is picked on the canvas and what can be done with it. */
export function CanvasPanel() {
  const { t } = useTranslation();
  const cell = useUi((s) => s.moderation.cell);
  const area = useUi((s) => s.moderation.area);
  const tab = cell ? "cell" : "area";
  if (!cell && !area) return <p className={styles.muted}>{t("admin.canvas.hint")}</p>;
  return (
    <Tabs
      label={t("admin.nav.canvas")}
      value={tab}
      onChange={() => {}}
      tabs={cell ? [{ id: "cell", label: t("admin.canvas.cellTab") }] : [{ id: "area", label: t("admin.canvas.areaTab") }]}
    >
      <div className={styles.form} style={{ paddingTop: 12 }}>
        {cell ? <CellInfo cell={cell} /> : area && <AreaTools area={area} />}
      </div>
    </Tabs>
  );
}

function CellInfo({ cell }: { cell: { x: number; y: number } }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.admin.canvas.inspect.queryOptions({ cell }));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const remove = useMutation({
    ...trpc.admin.moderation.execute.mutationOptions(),
    onSuccess: (res) => {
      setMessage(res.ok ? { text: resultText(res), error: false } : { text: adminErrorText(res.code), error: true });
      void queryClient.invalidateQueries({ queryKey: trpc.admin.canvas.inspect.pathKey() });
    },
    onError: () => setMessage({ text: adminErrorText(undefined), error: true }),
  });
  if (query.isPending) return <p className={styles.muted}>{t("common.loading")}</p>;
  if (query.isError) return <Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>;
  const d = query.data;
  return (
    <>
      <h2 className={styles.h2}>
        ({d.x}, {d.y})
      </h2>
      <dl className={styles.facts}>
        <dt>{t("admin.canvas.color")}</dt>
        <dd>
          <Swatch colorId={d.colorId} /> {d.colorId}
        </dd>
        <dt>{t("admin.canvas.owner")}</dt>
        <dd>{d.owner ? <PlayerLink user={d.owner} /> : t("admin.canvas.nobody")}</dd>
        <dt>{t("admin.canvas.bomb")}</dt>
        <dd>
          {d.bomb ? (
            <>
              <PlayerLink user={d.bomb.owner} /> · {fmt(d.bomb.createdAt)}
            </>
          ) : (
            t("admin.canvas.noBomb")
          )}
        </dd>
      </dl>
      {d.bomb && (
        <Button
          variant="danger"
          icon="bomb"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ action: { kind: "remove_bombs", area: { x1: d.x, y1: d.y, x2: d.x, y2: d.y } } })}
        >
          {t("admin.canvas.removeBomb")}
        </Button>
      )}
      {message && <p className={message.error ? styles.error : styles.ok}>{message.text}</p>}
      <h3 className={styles.h2}>{t("admin.canvas.cellHistory")}</h3>
      {d.history.length === 0 ? (
        <p className={styles.muted}>{t("admin.common.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {d.history.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list from one answer
            <li key={`${h.at}-${i}`} className={styles.row}>
              <span className={styles.muted}>{fmt(h.at)}</span>
              {h.user ? <PlayerLink user={h.user} /> : t("admin.common.none")}
              <Swatch colorId={h.prevColorId} />→<Swatch colorId={h.colorId} />
              <span className={styles.muted}>{kindText(h.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AreaTools({ area }: { area: Rect }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => toFields(area));
  const [mode, setMode] = useState<Mode>("to_time");
  const [at, setAt] = useState("");
  const [staged, setStaged] = useState<{ action: Action; cells: number; text: string; what: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  /** Bumped by every request and every change of its inputs; a late answer with an older token is dropped. */
  const token = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; a new area replaces the typed values and the preview
  useEffect(() => {
    setFields(toFields(area));
    token.current++;
    setStaged(null);
    setMessage(null);
  }, [area.x1, area.y1, area.x2, area.y2]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; a preview describes one exact action
  useEffect(() => {
    token.current++;
    setStaged(null);
  }, [mode, at]);

  const cells = rectCells(area);
  const tooLarge = cells > MAX_AREA_CELLS;
  const owners = useQuery({ ...trpc.admin.canvas.areaOwners.queryOptions({ area }), enabled: !tooLarge });
  const ownerList = owners.data?.ok ? owners.data.owners : [];

  const edit = (key: (typeof COORDS)[number], value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    const n = COORDS.map((k) => Number(next[k]));
    // Only a well-formed, ordered rectangle goes to the store (and the canvas frame) while typing.
    if (COORDS.every((k) => next[k] !== "") && n.every((v) => Number.isInteger(v) && v >= 0) && n[0]! <= n[2]! && n[1]! <= n[3]!) {
      uiStore.getState().setArea({ x1: n[0]!, y1: n[1]!, x2: n[2]!, y2: n[3]! });
    }
  };

  const preview = useMutation({
    mutationFn: ({ action }: { action: Action; what: string; token: number }) =>
      queryClient.fetchQuery({ ...trpc.admin.moderation.preview.queryOptions({ action }), staleTime: 0 }),
    onSuccess: (res, req) => {
      if (req.token !== token.current) return;
      if (res.ok) setStaged({ action: req.action, cells: res.cells, text: previewText(res), what: req.what });
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
        void queryClient.invalidateQueries({ queryKey: trpc.admin.canvas.areaOwners.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.admin.modLog.pathKey() });
      } else setMessage({ text: adminErrorText(res.code), error: true });
    },
    onError: () => {
      setStaged(null);
      setMessage({ text: adminErrorText(undefined), error: true });
    },
  });
  const busy = preview.isPending || apply.isPending;
  const atMs = at ? new Date(at).getTime() : Number.NaN;
  const action: Action | null =
    mode === "fill"
      ? { kind: "clear_area", area, mode: "fill" }
      : mode === "bombs"
        ? { kind: "remove_bombs", area }
        : Number.isFinite(atMs)
          ? { kind: "clear_area", area, mode: "to_time", at: atMs }
          : null;

  const calc = () => {
    if (!action) return;
    setMessage(null);
    preview.mutate({ action, what: describeAction(action, {}), token: ++token.current });
  };
  const run = () => staged && apply.mutate({ action: staged.action });

  const cards: Array<{ id: Mode; title: string; hint: string }> = [
    { id: "to_time", title: t("admin.canvas.toTime"), hint: t("admin.canvas.toTimeHint") },
    { id: "fill", title: t("admin.canvas.fill"), hint: t("admin.canvas.fillHint") },
    { id: "bombs", title: t("admin.canvas.removeBombs"), hint: t("admin.canvas.removeBombsHint") },
  ];
  return (
    <>
      <h2 className={styles.h2}>{t("admin.canvas.coords")}</h2>
      <div className={c.coords}>
        {COORDS.map((k) => (
          <Field key={k} label={t(`admin.canvas.${k}`)}>
            {(ctl) => <Input {...ctl} type="number" inputMode="numeric" min={0} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />}
          </Field>
        ))}
      </div>
      <p className={styles.muted}>{rectText(area)}</p>
      {tooLarge && <p className={styles.error}>{t("admin.canvas.areaTooLarge", { n: formatNumber(MAX_AREA_CELLS) })}</p>}

      <h3 className={styles.h2}>{t("admin.canvas.authors")}</h3>
      {ownerList.length === 0 ? (
        <p className={styles.muted}>{owners.isPending && !tooLarge ? t("common.loading") : t("admin.canvas.noAuthors")}</p>
      ) : (
        <ul className={styles.list}>
          {ownerList.map((o) => (
            <li key={o.user.id} className={styles.row}>
              <PlayerLink user={o.user} />
              <span className={styles.muted}>{cellsText(o.cells)}</span>
            </li>
          ))}
        </ul>
      )}

      {cards.map((card) => (
        <button key={card.id} type="button" className={c.actionCard} aria-pressed={mode === card.id} onClick={() => setMode(card.id)}>
          <span className={c.actionTitle}>{card.title}</span>
          <span className={styles.muted}>{card.hint}</span>
        </button>
      ))}
      {mode === "to_time" && (
        <Field label={t("admin.canvas.at")}>{(ctl) => <Input {...ctl} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
      )}
      <Button disabled={busy || tooLarge || !action} onClick={calc}>
        {t("admin.common.preview")}
      </Button>
      {staged && (
        <div className={styles.staged} role="status">
          <p>{staged.what}</p>
          <p>{staged.text}</p>
          <div className={styles.row}>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => (staged.action.kind === "clear_area" && staged.action.mode === "fill" ? setConfirm(true) : run())}
            >
              {t("admin.canvas.applyCells", { cells: cellsText(staged.cells) })}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStaged(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.error ? styles.error : styles.ok} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        title={t("admin.canvas.confirmFill", { cells: cellsText(staged?.cells ?? 0) })}
        confirmLabel={t("admin.canvas.fill")}
        danger
        busy={busy}
        onConfirm={() => {
          setConfirm(false);
          run();
        }}
        onCancel={() => setConfirm(false)}
      >
        {t("admin.canvas.confirmFillText")}
      </ConfirmDialog>
    </>
  );
}

function toFields(r: Rect): Record<(typeof COORDS)[number], string> {
  return { x1: String(r.x1), y1: String(r.y1), x2: String(r.x2), y2: String(r.y2) };
}
