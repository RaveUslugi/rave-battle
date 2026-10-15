import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../i18n";
import { Button } from "./Button";
import styles from "./kit.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  /** Name the action exactly: "Заблокировать навсегда", not "OK". */
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation for irreversible actions, on the native <dialog> (focus trap, Esc, backdrop). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <div className={styles.dialogBody}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          {children && <div className={styles.dialogText}>{children}</div>}
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
