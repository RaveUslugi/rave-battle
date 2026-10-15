import { type ReactNode, useId, useRef } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { nextIndex } from "./keys";
import styles from "./kit.module.css";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Content of the selected tab. */
  children: ReactNode;
  className?: string;
}

/** Tablist with automatic activation: arrows and Home/End switch tabs, one tab stop. */
export function Tabs<T extends string>({ tabs, value, onChange, label, children, className }: TabsProps<T>) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={styles.tabs}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={i === current ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const next = nextIndex(e.key, i, tabs.length);
              if (next === null) return;
              e.preventDefault();
              onChange(tabs[next]!.id);
              refs.current[next]?.focus();
            }}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tabs[current]?.id}`}>
        {children}
      </div>
    </div>
  );
}
