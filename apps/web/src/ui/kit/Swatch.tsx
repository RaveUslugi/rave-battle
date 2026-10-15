import { effectColorAt, type PaletteEntry } from "@rave/shared/client";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { Icon } from "./Icon";
import styles from "./kit.module.css";
import { useReducedMotion } from "./motion";

/** Frame interval for animated swatches: smooth enough for a 20 px square, cheap for 48 of them. */
const FRAME_MS = 100;

/** CSS background of a swatch: gradients show their stops along the angle, everything else one colour at time `t`. */
export function swatchBackground(entry: PaletteEntry, t: number): string {
  if (entry.type === "gradient") {
    const stops = [...entry.params.stops, entry.params.stops[0]!];
    return `linear-gradient(${90 + entry.params.angle}deg, ${stops.join(", ")})`;
  }
  return effectColorAt(entry, 0, 0, t);
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), FRAME_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export interface SwatchProps {
  entry: PaletteEntry;
  selected?: boolean;
  locked?: boolean;
  /** Accessible name; defaults to the colour's name or number. */
  label?: string;
  size?: number;
  onSelect?: () => void;
  className?: string;
}

/** One palette colour as a radio button (inside a radiogroup), animated for effect colours. */
export function Swatch({ entry, selected = false, locked = false, label, size = 22, onSelect, className }: SwatchProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const now = useNow(entry.type === "animated" && !reduced);
  const name = label ?? entry.name?.[i18n.language === "en" ? "en" : "ru"] ?? `#${entry.id}`;
  const fx = entry.type !== "solid";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled radio in a roving-tabindex radiogroup; a native radio cannot render this
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={[name, fx ? t("kit.effect") : null, locked ? t("kit.locked") : null].filter(Boolean).join(", ")}
      className={[styles.swatch, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, background: swatchBackground(entry, now) }}
      onClick={onSelect}
    >
      {fx && size >= 20 && (
        <span className={styles.swatchFx} aria-hidden="true">
          <Icon name="effect" size={Math.max(8, Math.round(size / 3))} />
        </span>
      )}
      {locked && (
        <span className={styles.swatchLock} aria-hidden="true">
          <Icon name="lock" size={Math.max(8, Math.round(size / 2))} />
        </span>
      )}
    </button>
  );
}
