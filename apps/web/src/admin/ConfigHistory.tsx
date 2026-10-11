import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { GameConfig } from "@rave/shared";
import { useTRPC } from "../net/trpc";
import { configDiff } from "./config-draft";
import styles from "./admin.module.css";

export type ConfigAnswer =
  | { ok: true; version: number }
  | { ok: false; code: "stale"; currentVersion: number }
  | { ok: false; code: "invalid"; issues: Array<{ path: string; message: string }> }
  | { ok: false; code: "not_found" };

export function DiffList({ diff }: { diff: ReturnType<typeof configDiff> }) {
  if (diff.length === 0) return <p className={styles.message}>Изменений нет</p>;
  return (
    <ul className={`${styles.log} ${styles.mono}`}>
      {diff.map((d) => (
        <li key={d.path}>
          {d.path}: {d.before} → {d.after}
        </li>
      ))}
    </ul>
  );
}

const fmt = (ms: number) => new Date(ms).toLocaleString("ru-RU");
const COMMENT_MAX = 200;

interface Props {
  current: { version: number; config: GameConfig };
  /** Version the editor draft was built from; rollbacks go against it so a concurrent change stays stale. */
  baseVersion: number;
  onAnswer: (res: ConfigAnswer) => void;
  onFailed: () => void;
}

export function ConfigHistory({ current, baseVersion, onAnswer, onFailed }: Props) {
  const trpc = useTRPC();
  const history = useQuery(trpc.admin.config.history.queryOptions());
  const [selected, setSelected] = useState<number | null>(null);
  const [rolling, setRolling] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const preview = useQuery({
    ...trpc.admin.config.get.queryOptions({ version: selected ?? 1 }),
    enabled: selected !== null,
  });
  const rollback = useMutation({
    ...trpc.admin.config.rollback.mutationOptions(),
    onSuccess: (res: ConfigAnswer) => {
      if (res.ok) {
        setRolling(null);
        setSelected(null);
        setComment("");
      }
      onAnswer(res);
    },
    onError: onFailed,
  });

  const submit = (e: FormEvent, version: number) => {
    e.preventDefault();
    if (comment.trim().length === 0) return;
    rollback.mutate({ version, baseVersion, comment: comment.trim() });
  };

  return (
    <section className={styles.configBlock}>
      <h3 className={styles.subtitle}>История версий</h3>
      {history.isPending && <p className={styles.message}>Загрузка…</p>}
      {history.isError && <p className={styles.error}>Не удалось загрузить историю</p>}
      {history.data && (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Версия</th>
                <th>Дата</th>
                <th>Автор</th>
                <th>Комментарий</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.data.map((h) => {
                const isCurrent = h.version === current.version;
                return (
                  <tr key={h.version}>
                    <td>
                      {h.version}
                      {isCurrent && <span className={styles.badge}> текущая</span>}
                    </td>
                    <td>{fmt(h.createdAt)}</td>
                    <td>{h.createdBy?.name ?? "—"}</td>
                    <td className={styles.wrap}>{h.comment}</td>
                    <td>
                      <button type="button" className={styles.button} onClick={() => setSelected(selected === h.version ? null : h.version)}>
                        Показать
                      </button>{" "}
                      {!isCurrent && (
                        <button type="button" className={styles.button} onClick={() => setRolling(h.version)}>
                          Откатить к этой
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected !== null && (
        <div>
          <h4 className={styles.subtitle}>Что изменится при откате к версии {selected}</h4>
          {preview.isPending && <p className={styles.message}>Загрузка…</p>}
          {preview.isError && <p className={styles.error}>Не удалось загрузить версию</p>}
          {preview.data && <DiffList diff={configDiff(current.config, preview.data as GameConfig)} />}
        </div>
      )}

      {rolling !== null && (
        <form className={styles.form} onSubmit={(e) => submit(e, rolling)}>
          <h4 className={styles.subtitle}>
            Откат к версии {rolling}: появится новая версия {current.version + 1}
          </h4>
          <label className={styles.field}>
            Комментарий
            <input className={styles.input} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className={styles.row}>
            <button type="submit" className={styles.button} disabled={rollback.isPending || comment.trim().length === 0}>
              Подтвердить откат
            </button>
            <button type="button" className={styles.button} onClick={() => setRolling(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
