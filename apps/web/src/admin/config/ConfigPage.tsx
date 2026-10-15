import {
  CONFIG_FORM,
  CONFIG_SECTIONS,
  type ConfigIssue,
  type ConfigSectionId,
  configWarnings,
  type FieldMeta,
  type GameConfig,
  type Reward,
  toShown,
  toStored,
} from "@rave/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { formatNumber, i18n, useTranslation } from "../../i18n";
import { useTRPC } from "../../net/trpc";
import { Button, Checkbox, ConfirmDialog, Field, IconButton, Input } from "../../ui/kit";
import styles from "../admin.module.css";
import { adminErrorText } from "../format";
import { useSearchParam } from "../useSearchParam";
import f from "./config.module.css";
import { ConfigHistory } from "./ConfigHistory";
import { changedSections, checkConfig, configDiff, getAt, type Issues, issuesByPath, issuesUnder, sectionsWithIssues, setAt } from "./draft";
import { PaletteEditor } from "./PaletteEditor";

const COMMENT_MAX = 200;
type SaveAnswer =
  | { ok: true; version: number }
  | { ok: false; code: "stale"; currentVersion: number }
  | { ok: false; code: "invalid"; issues: ConfigIssue[] }
  | { ok: false; code: "not_found" };

/** Dictionary lookups by a computed key (field paths). */
const tk = (key: string): string => i18n.t(key as "admin.title");
const REWARD_ITEMS: Reward["item"][] = ["coins", "bomb", "detector", "defuser"];

interface FieldProps {
  meta: FieldMeta;
  draft: GameConfig;
  saved: GameConfig;
  issues: Issues;
  warnings: Map<string, string[]>;
  onChange: (path: string, value: unknown) => void;
}

function shownText(value: unknown, meta: FieldMeta): string {
  if (meta.kind !== "number") return String(value);
  return typeof value === "number" && Number.isFinite(value) ? String(toShown(value, meta)) : "";
}

function ConfigField({ meta, draft, saved, issues, warnings, onChange }: FieldProps) {
  const { t } = useTranslation();
  const value = getAt(draft, meta.path);
  const before = getAt(saved, meta.path);
  const changed = JSON.stringify(value) !== JSON.stringify(before);
  const label = tk(`admin.field.${meta.path}`);
  const hintKey = `admin.fieldHint.${meta.path}`;
  const problems = issuesUnder(issues, meta.path);
  const warns = (warnings.get(meta.path) ?? []).map((code) => tk(`admin.warn.${code}`));
  const hint = [
    i18n.exists(hintKey) ? tk(hintKey) : null,
    changed && meta.kind !== "rewards" ? t("admin.config.was", { value: shownText(before, meta) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (meta.kind === "boolean")
    return <Checkbox label={label} checked={value === true} onChange={(e) => onChange(meta.path, e.target.checked)} data-changed={changed || undefined} />;
  if (meta.kind === "rewards")
    return <RewardsField rewards={value as Reward[]} saved={before as Reward[]} problems={problems} onChange={(r) => onChange(meta.path, r)} />;
  return (
    <div className={f.field}>
      <Field
        label={label}
        unit={meta.kind === "number" ? tk(`admin.unit.${meta.unit}`) : undefined}
        hint={hint || undefined}
        error={problems.join(" · ") || undefined}
      >
        {(c) =>
          meta.kind === "timezone" ? (
            <Input {...c} changed={changed} value={String(value ?? "")} onChange={(e) => onChange(meta.path, e.target.value)} />
          ) : (
            <Input
              {...c}
              type="number"
              inputMode="decimal"
              changed={changed}
              step={meta.step ? toShown(meta.step, meta) : "any"}
              value={shownText(value, meta)}
              onChange={(e) => onChange(meta.path, e.target.value === "" ? Number.NaN : toStored(Number(e.target.value), meta))}
            />
          )
        }
      </Field>
      {warns.map((w) => (
        <p key={w} className={f.warning}>
          {w}
        </p>
      ))}
    </div>
  );
}

/** Daily rewards as rows: day, what, how many. */
function RewardsField({ rewards, saved, problems, onChange }: { rewards: Reward[]; saved: Reward[]; problems: string[]; onChange: (r: Reward[]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<Reward>) => onChange(rewards.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className={f.field}>
      <span className={f.label}>{t("admin.config.rewards")}</span>
      <ol className={f.rewards}>
        {rewards.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in the reward loop
          <li key={i} className={f.reward} data-changed={JSON.stringify(r) !== JSON.stringify(saved[i]) || undefined}>
            <span className={f.day}>{t("admin.config.rewardDay", { n: i + 1 })}</span>
            <select
              className={styles.select}
              aria-label={`${t("admin.config.rewardDay", { n: i + 1 })}: ${t("admin.config.rewardItem")}`}
              value={r.item}
              onChange={(e) => set(i, { item: e.target.value as Reward["item"] })}
            >
              {REWARD_ITEMS.map((item) => (
                <option key={item} value={item}>
                  {t(`admin.item.${item}`)}
                </option>
              ))}
            </select>
            <Input
              type="number"
              aria-label={`${t("admin.config.rewardDay", { n: i + 1 })}: ${t("admin.config.rewardAmount")}`}
              value={Number.isFinite(r.amount) ? String(r.amount) : ""}
              onChange={(e) => set(i, { amount: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
            />
            <IconButton
              icon="minus"
              size={36}
              label={t("admin.config.removeDay", { n: i + 1 })}
              disabled={rewards.length <= 1}
              onClick={() => onChange(rewards.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <Button icon="plus" onClick={() => onChange([...rewards, { item: "coins", amount: 10 }])}>
        {t("admin.config.addDay")}
      </Button>
      {problems.length > 0 && <p className={styles.error}>{problems.join(" · ")}</p>}
    </div>
  );
}

/**
 * The live config as a form: sections on the left (gold dot = changed, red = problems), fields with
 * units and "was N", the save bar at the bottom with a diff to confirm, version history on the right.
 */
export function ConfigPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const current = useQuery(trpc.admin.config.current.queryOptions());
  const [sectionParam, setSection] = useSearchParam("section");
  const section: ConfigSectionId = CONFIG_SECTIONS.find((s) => s === sectionParam) ?? "canvas";
  const [base, setBase] = useState<{ version: number; config: GameConfig } | null>(null);
  const [draft, setDraft] = useState<GameConfig | null>(null);
  const [remote, setRemote] = useState<Issues>(new Map());
  const [confirm, setConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<{ text: string; error: boolean; stale?: boolean } | null>(null);
  const [awaiting, setAwaiting] = useState<number | null>(null);

  // The draft is built once and survives refetches; a saved or rolled-back version (or an explicit reload) replaces it.
  if (current.data && (base === null || (awaiting !== null && current.data.version >= awaiting))) {
    setBase(current.data);
    setDraft(structuredClone(current.data.config));
    setRemote(new Map());
    setAwaiting(null);
  }

  const checked = useMemo(() => (draft ? checkConfig(draft) : null), [draft]);
  const issues: Issues = useMemo(() => new Map([...(checked?.issues ?? []), ...remote]), [checked, remote]);
  // From the draft as typed: a problem in one field must not hide the warnings and changes of the others.
  const warnings = useMemo(() => (draft ? configWarnings(draft) : new Map<string, string[]>()), [draft]);
  const dirty = useMemo(() => (base && draft ? changedSections(base.config, draft) : new Set<ConfigSectionId>()), [base, draft]);
  const diff = useMemo(() => (base && draft ? configDiff(base.config, draft) : []), [base, draft]);
  const broken = sectionsWithIssues(issues);

  const refresh = () => {
    for (const key of [trpc.admin.config.current.pathKey(), trpc.admin.config.history.pathKey(), trpc.admin.modLog.pathKey()])
      void queryClient.invalidateQueries({ queryKey: key });
  };
  const handleAnswer = (res: SaveAnswer) => {
    if (res.ok) {
      setStatus({ text: t("admin.config.saved", { n: res.version }), error: false });
      setComment("");
      setAwaiting(res.version);
    } else if (res.code === "invalid") {
      setRemote(issuesByPath(res.issues));
      setStatus({ text: adminErrorText("invalid"), error: true });
    } else setStatus({ text: adminErrorText(res.code), error: true, stale: res.code === "stale" });
    refresh();
  };
  const save = useMutation({
    ...trpc.admin.config.save.mutationOptions(),
    onSuccess: handleAnswer,
    onError: () => setStatus({ text: t("admin.common.failed"), error: true }),
  });

  if (current.isError && !current.data) return <p className={styles.error}>{t("admin.common.failed")}</p>;
  if (!base || !draft) return <p className={styles.muted}>{t("common.loading")}</p>;

  const onChange = (path: string, value: unknown) => {
    setDraft((d) => (d ? setAt(d, path, value) : d));
    setRemote(new Map());
    setStatus(null);
  };
  const next = base.version + 1;
  const elsewhere = [...broken].filter((s) => s !== section).map((s) => tk(`admin.section.${s}`));

  return (
    <div className={f.layout}>
      <nav className={f.sections} aria-label={t("admin.config.sections")}>
        {CONFIG_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={f.section}
            aria-current={s === section ? "true" : undefined}
            onClick={() => {
              setSection(s === "canvas" ? null : s);
              setStatus(null);
            }}
          >
            {tk(`admin.section.${s}`)}
            {broken.has(s) ? (
              <span className={f.dot} data-tone="red" />
            ) : dirty.has(s) ? (
              <span className={f.dot} data-tone="gold">
                <span className="visually-hidden">{t("admin.config.changed")}</span>
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <section className={f.form} aria-labelledby="config-section-title">
        <h1 id="config-section-title" className={styles.h1}>
          {tk(`admin.section.${section}`)}
        </h1>
        {section === "palette" ? (
          <PaletteEditor palette={draft.palette} saved={base.config.palette} issues={issues} onChange={(p) => onChange("palette", p)} />
        ) : (
          CONFIG_FORM[section].map((meta) => (
            <ConfigField key={meta.path} meta={meta} draft={draft} saved={base.config} issues={issues} warnings={warnings} onChange={onChange} />
          ))
        )}
        {elsewhere.length > 0 && <p className={styles.error}>{t("admin.config.issuesElsewhere", { list: elsewhere.join(", ") })}</p>}
      </section>
      <aside className={f.history}>
        <ConfigHistory currentVersion={base.version} dirty={dirty.size > 0} onAnswer={handleAnswer} />
      </aside>
      <div className={f.saveBar}>
        <span className={f.summary}>
          {diff.length > 0 ? t("admin.config.changes", { n: formatNumber(diff.length), m: dirty.size }) : t("admin.config.noChanges")}
        </span>
        {status && (
          <span className={status.error ? styles.error : styles.ok} role={status.error ? "alert" : "status"}>
            {status.text}
          </span>
        )}
        {status?.stale && <Button onClick={() => setAwaiting(0)}>{t("admin.config.reload")}</Button>}
        <Button
          variant="ghost"
          disabled={dirty.size === 0}
          onClick={() => {
            setDraft(structuredClone(base.config));
            setRemote(new Map());
          }}
        >
          {t("admin.config.reset")}
        </Button>
        <Button variant="primary" disabled={diff.length === 0 || checked?.config === null || save.isPending} onClick={() => setConfirm(true)}>
          {t("admin.config.saveAs", { n: next })}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t("admin.config.saveTitle", { n: next })}
        confirmLabel={t("admin.config.saveAs", { n: next })}
        busy={save.isPending || !comment.trim()}
        onConfirm={() => {
          if (!comment.trim() || !checked?.config) return;
          setConfirm(false);
          save.mutate({ baseVersion: base.version, config: checked.config, comment: comment.trim() });
        }}
        onCancel={() => setConfirm(false)}
      >
        <DiffList diff={diff} />
        <Field label={t("admin.config.commentRequired")}>
          {(c) => <Input {...c} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

export function DiffList({ diff }: { diff: ReturnType<typeof configDiff> }) {
  const { t } = useTranslation();
  if (diff.length === 0) return <p className={styles.muted}>{t("admin.config.noChanges")}</p>;
  return (
    <ul className={f.diff}>
      {diff.map((d) => (
        <li key={d.path}>
          <span className={f.path}>{d.path}</span>: <s>{d.before}</s> → <b>{d.after}</b>
        </li>
      ))}
    </ul>
  );
}
