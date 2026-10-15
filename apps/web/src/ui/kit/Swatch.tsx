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
  /** Square side in px; null leaves the size to the class (e.g. a stretching row). */
  size?: number | null;
  onSelect?: () => void;
  className?: string;
  /** Roving tab stop inside the radiogroup. */
  tabIndex?: number;
  /** Lets the group find a colour's button to move focus to it. */
  "data-color"?: number;
}

/** One palette colour as a radio button (inside a radiogroup), animated for effect colours. */
export function Swatch({ entry, selected = false, locked = false, label, size = 22, onSelect, className, tabIndex, ...data }: SwatchProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const now = useNow(entry.type === "animated" && !reduced);
  const name = label ?? entry.name?.[i18n.language === "en" ? "en" : "ru"] ?? t("kit.colorN", { id: entry.id });
  const fx = entry.type !== "solid";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled radio in a roving-tabindex radiogroup; a native radio cannot render this
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      data-color={data["data-color"]}
      aria-label={[name, fx ? t("kit.effect") : null, locked ? t("kit.locked") : null].filter(Boolean).join(", ")}
      className={[styles.swatch, className].filter(Boolean).join(" ")}
      style={{ ...(size === null ? {} : { width: size, height: size }), background: swatchBackground(entry, now) }}
      onClick={onSelect}
    >
      {fx && (size === null || size >= 20) && (
        <span className={styles.swatchFx} aria-hidden="true">
          <Icon name="effect" size={size === null ? 12 : Math.max(8, Math.round(size / 3))} />
        </span>
      )}
      {locked && (
        <span className={styles.swatchLock} aria-hidden="true">
          <Icon name="lock" size={size === null ? 12 : Math.max(8, Math.round(size / 2))} />
        </span>
      )}
    </button>
  );
}

/** A decorative block of a colour, animated like the swatch (e.g. in shop cards). */
export function ColorPreview({ entry, className }: { entry: PaletteEntry; className?: string }) {
  const reduced = useReducedMotion();
  const now = useNow(entry.type === "animated" && !reduced);
  return (
    <span className={[styles.preview, className].filter(Boolean).join(" ")} style={{ background: swatchBackground(entry, now) }} aria-hidden="true">
      {entry.type !== "solid" && (
        <span className={styles.swatchFx}>
          <Icon name="effect" size={12} />
        </span>
      )}
    </span>
  );
}
