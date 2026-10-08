import { useEffect } from "react";
import { uiStore, useUi, type Toast } from "../state/ui-store";
import styles from "./Toasts.module.css";

const LIFETIME_MS = 4000;

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const id = setTimeout(() => uiStore.getState().dismissToast(toast.id), LIFETIME_MS);
    return () => clearTimeout(id);
  }, [toast.id]);
  return (
    <div className={toast.kind === "error" ? styles.error : styles.info} role={toast.kind === "error" ? "alert" : "status"}>
      {toast.text}
    </div>
  );
}

/** Short messages that dismiss themselves; errors are announced as alerts. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className={styles.stack}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
