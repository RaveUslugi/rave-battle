import { useRef } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { nextIndex } from "./keys";
import styles from "./kit.module.css";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers. */
  label: string;
  className?: string;
}

/** A radiogroup of buttons: one tab stop, arrows and Home/End move the choice. */
export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div role="radiogroup" aria-label={label} className={[styles.segmented, className].filter(Boolean).join(" ")}>
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled radio in a roving-tabindex radiogroup; a native radio cannot render this
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === current ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const next = nextIndex(e.key, i, options.length);
            if (next === null) return;
            e.preventDefault();
            onChange(options[next]!.value);
            refs.current[next]?.focus();
          }}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
