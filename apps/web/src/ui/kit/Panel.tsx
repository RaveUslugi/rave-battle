import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface PanelProps {
  title?: ReactNode;
  /** Right side of the header: a close button, filters. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  "aria-label"?: string;
}

export function Panel({ title, actions, children, className, bodyClassName, ...rest }: PanelProps) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")} aria-label={rest["aria-label"]}>
      {(title || actions) && (
        <header className={styles.panelHead}>
          {title && <h2 className={styles.panelTitle}>{title}</h2>}
          {actions}
        </header>
      )}
      <div className={[styles.panelBody, bodyClassName].filter(Boolean).join(" ")}>{children}</div>
    </section>
  );
}
