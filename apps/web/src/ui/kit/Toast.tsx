import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import styles from "./kit.module.css";

export type ToastTone = "error" | "success" | "info";
const TONE_ICON: Record<ToastTone, IconName> = { error: "close", success: "check", info: "detector" };
const TONE_COLOR: Record<ToastTone, string> = { error: "var(--red)", success: "var(--lime)", info: "var(--cyan)" };

export interface ToastProps {
  tone: ToastTone;
  icon?: IconName;
  /** Repeats of the same message, shown as "×3". */
  count?: number;
  children: ReactNode;
}

export function Toast({ tone, icon, count = 1, children }: ToastProps) {
  return (
    <div className={styles.toast} data-tone={tone}>
      <span style={{ color: TONE_COLOR[tone], display: "inline-flex" }}>
        <Icon name={icon ?? TONE_ICON[tone]} />
      </span>
      <span>{children}</span>
      {count > 1 && <span className={styles.toastCount}>×{count}</span>}
    </div>
  );
}
