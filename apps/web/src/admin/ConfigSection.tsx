import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTRPC } from "../net/trpc";
import { checkDraft, configDiff, draftFrom, SECTIONS, serverIssues, type Draft, type Issues, type Section } from "./config-draft";
import { ConfigHistory, DiffList, type ConfigAnswer } from "./ConfigHistory";
import { adminErrorText } from "./labels";
import { PaletteTable } from "./PaletteTable";
import styles from "./admin.module.css";

const FAILED = "Не удалось выполнить действие";
const COMMENT_MAX = 200;

function IssueList({ issues }: { issues: string[] | undefined }) {
  if (!issues || issues.length === 0) return null;
  return (
    <ul className={styles.issues}>
      {issues.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, items never reorder
        <li key={i} className={styles.error}>
          {m}
        </li>
      ))}
    </ul>
  );
}

export function ConfigSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const current = useQuery(trpc.admin.config.current.queryOptions());

  const [draft, setDraft] = useState<Draft | null>(null);
  const [expectVersion, setExpectVersion] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [remote, setRemote] = useState<Issues>({});
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // The version the draft was built from; every save stays against it until the admin reloads explicitly.
  const [draftBase, setDraftBase] = useState<number | null>(null);

  // The draft is created once and survives refetches; only an explicit reload (or a saved version) replaces it.
  if (draft === null && current.data) {
    setDraft(draftFrom(current.data.config));
    setDraftBase(current.data.version);
  }
  useEffect(() => {
    if (expectVersion !== null && current.data && current.data.version >= expectVersion) {
      setDraft(draftFrom(current.data.config));
      setDraftBase(current.data.version);
      setExpectVersion(null);
    }
  }, [expectVersion, current.data]);

  const checked = useMemo(() => (draft ? checkDraft(draft) : null), [draft]);
  const diff = useMemo(() => (current.data && checked?.config ? configDiff(current.data.config, checked.config) : []), [current.data, checked]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.admin.config.current.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.admin.config.history.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.admin.modLog.pathKey() });
  };

  const onAnswer = (res: ConfigAnswer) => {
    if (res.ok) {
      setRemote({});
      setOpen(false);
      setComment("");
      setStatus({ kind: "ok", text: `Сохранено: версия ${res.version}` });
      setExpectVersion(res.version);
      refresh();
    } else if (res.code === "stale") {
      setStatus({ kind: "error", text: `Конфиг уже изменили (версия ${res.currentVersion}). Ваш черновик сохранён` });
      refresh();
    } else if (res.code === "invalid") {
      setRemote(serverIssues(res.issues));
      setStatus({ kind: "error", text: adminErrorText("invalid") });
    } else {
      setStatus({ kind: "error", text: adminErrorText(res.code) });
    }
  };
  const onFailed = () => setStatus({ kind: "error", text: FAILED });

  const save = useMutation({ ...trpc.admin.config.save.mutationOptions(), onSuccess: onAnswer, onError: onFailed });

  if (current.isPending) return <p className={styles.message}>Загрузка…</p>;
  if (current.isError) return <p className={styles.error}>Не удалось загрузить конфиг</p>;
  if (draft === null || checked === null) return null;

  const { version, config: live } = current.data;
  const dirty = checked.config === null || diff.length > 0;
  const issues: Issues = {};
  for (const section of [...SECTIONS, "palette", "general"] as Section[]) {
    const all = [...(checked.issues[section] ?? []), ...(remote[section] ?? [])];
    if (all.length > 0) issues[section] = all;
  }
  const hasErrors = checked.config === null;
  const staleNow = draftBase !== null && draftBase !== version;

  const edit = (next: Draft) => {
    setDraft(next);
    setRemote({});
  };
  const reload = () => {
    if (dirty && !window.confirm("Черновик пропадёт. Загрузить текущую версию?")) return;
    setDraft(draftFrom(live));
    setRemote({});
    setDraftBase(version);
    setStatus(null);
    setOpen(false);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!checked.config || comment.trim().length === 0) return;
    setStatus(null);
    save.mutate({ baseVersion: draftBase ?? version, config: checked.config, comment: comment.trim() });
  };

  return (
    <div>
      <p>
        Версия {version}
        {dirty && <span className={styles.badge}> · есть несохранённые изменения</span>}
        {dirty && (
          <>
            {" "}
            <button type="button" className={styles.linkButton} onClick={reload}>
              Загрузить текущую версию
            </button>
          </>
        )}
      </p>

      {SECTIONS.map((key) => {
        const text = draft.texts[key];
        return (
          <section key={key} className={styles.configBlock}>
            <h3 className={`${styles.subtitle} ${styles.mono}`}>{key}</h3>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              spellCheck={false}
              rows={Math.max(2, text.split("\n").length)}
              value={text}
              aria-label={key}
              aria-invalid={(issues[key]?.length ?? 0) > 0}
              onChange={(e) => edit({ ...draft, texts: { ...draft.texts, [key]: e.target.value } })}
            />
            <IssueList issues={issues[key]} />
          </section>
        );
      })}

      <section className={styles.configBlock}>
        <h3 className={`${styles.subtitle} ${styles.mono}`}>palette</h3>
        <PaletteTable value={draft.palette} onChange={(palette) => edit({ ...draft, palette })} />
        <IssueList issues={issues.palette} />
      </section>

      <IssueList issues={issues.general} />

      <div className={styles.saveBar}>
        {!open ? (
          <button type="button" className={styles.button} disabled={hasErrors || diff.length === 0} onClick={() => setOpen(true)}>
            Проверить и сохранить…
          </button>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <DiffList diff={diff} />
            <label className={styles.field}>
              Комментарий
              <input className={styles.input} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} />
            </label>
            <div className={styles.row}>
              <button
                type="submit"
                className={styles.button}
                disabled={save.isPending || staleNow || hasErrors || diff.length === 0 || comment.trim().length === 0}
              >
                Сохранить как версию {version + 1}
              </button>
              <button type="button" className={styles.button} onClick={() => setOpen(false)}>
                Отмена
              </button>
            </div>
          </form>
        )}
        {status && (
          <p className={status.kind === "ok" ? styles.toast : styles.error} role="status">
            {status.text}
          </p>
        )}
        {staleNow && (
          <p className={styles.error}>
            Конфиг уже изменили (версия {version}), а черновик собран на версии {draftBase}. Сохранить его нельзя — загрузите текущую версию.
          </p>
        )}
        {staleNow && (
          <button type="button" className={styles.button} onClick={reload}>
            Загрузить текущую версию
          </button>
        )}
      </div>

      <ConfigHistory current={current.data} baseVersion={draftBase ?? version} dirty={dirty} onAnswer={onAnswer} onRefresh={refresh} onFailed={onFailed} />
    </div>
  );
}
