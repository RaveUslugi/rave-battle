import type { ConfigIssue } from "@rave/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "../../i18n";
import { useTRPC } from "../../net/trpc";
import { Button, ConfirmDialog, Field, Input } from "../../ui/kit";
import styles from "../admin.module.css";
import { fmt } from "../format";
import f from "./config.module.css";

const COMMENT_MAX = 200;

type Answer =
  | { ok: true; version: number }
  | { ok: false; code: "stale"; currentVersion: number }
  | { ok: false; code: "invalid"; issues: ConfigIssue[] }
  | { ok: false; code: "not_found" };

/** Saved versions, newest first; any older one can be made current again (as a new version). */
export function ConfigHistory({ currentVersion, dirty, onAnswer }: { currentVersion: number; dirty: boolean; onAnswer: (res: Answer) => void }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const history = useQuery(trpc.admin.config.history.queryOptions());
  const [target, setTarget] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const rollback = useMutation({
    ...trpc.admin.config.rollback.mutationOptions(),
    onSuccess: (res: Answer) => {
      setTarget(null);
      setComment("");
      onAnswer(res);
    },
  });

  return (
    <div className={styles.form}>
      <h2 className={styles.h2}>{t("admin.config.history")}</h2>
      {history.isError && <p className={styles.error}>{t("admin.common.failed")}</p>}
      <ol className={f.versions}>
        {history.data?.map((h) => (
          <li key={h.version} className={f.version} data-current={h.version === currentVersion || undefined}>
            <span className={styles.num}>v{h.version}</span>
            {h.version === currentVersion && <span className={styles.badge}>{t("admin.config.current")}</span>}
            <span className={f.versionComment}>{h.comment}</span>
            <span className={styles.muted}>
              {h.createdBy?.name ?? t("admin.common.none")} · {fmt(h.createdAt)}
            </span>
            {h.version !== currentVersion && (
              <Button variant="ghost" icon="undo" onClick={() => setTarget(h.version)}>
                {t("admin.config.rollbackTo", { n: h.version })}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <ConfirmDialog
        open={target !== null}
        title={t("admin.config.rollbackTitle", { n: target ?? 0 })}
        confirmLabel={t("admin.config.rollbackTo", { n: target ?? 0 })}
        danger
        busy={rollback.isPending || !comment.trim()}
        onConfirm={() => target !== null && rollback.mutate({ version: target, baseVersion: currentVersion, comment: comment.trim() })}
        onCancel={() => setTarget(null)}
      >
        {dirty && <p className={styles.error}>{t("admin.config.rollbackDirty")}</p>}
        <Field label={t("admin.config.commentRequired")}>
          {(c) => <Input {...c} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
