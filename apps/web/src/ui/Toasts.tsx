import { useEffect } from "react";
import { uiStore, useUi, type Toast } from "../state/ui-store";
import styles from "./Toasts.module.css";

const LIFETIME_MS = 4000;

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const id = setTimeout(() => uiStore.getState().dismissToast(toast.id), LIFETIME_MS);
    return () => clearTimeout(id);
  }, [toast.id]);
  return <div className={toast.kind === "error" ? styles.error : styles.info}>{toast.text}</div>;
}

/**
 * Short messages that dismiss themselves. The live regions stay mounted: screen readers often skip
 * content of a region that is inserted together with it.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className={styles.stack}>
      <div className={styles.region} role="alert">
        {toasts.filter((t) => t.kind === "error").map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
      <div className={styles.region} role="status">
        {toasts.filter((t) => t.kind === "info").map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </div>
  );
}
