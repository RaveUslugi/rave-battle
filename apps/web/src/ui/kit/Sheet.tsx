import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../i18n";
import styles from "./kit.module.css";

export const SHEET_HEIGHTS = ["peek", "half", "full"] as const;
export type SheetHeight = (typeof SHEET_HEIGHTS)[number];

/** Drag distance (px) that moves the sheet one height up or down. */
const STEP_PX = 60;

/** Height after a drag of `dy` px (negative = up); null = dragged below the lowest height, close it. */
export function heightAfterDrag(height: SheetHeight, dy: number): SheetHeight | null {
  const steps = Math.trunc(-dy / STEP_PX);
  const index = SHEET_HEIGHTS.indexOf(height) + steps;
  if (index < 0) return null;
  return SHEET_HEIGHTS[Math.min(index, SHEET_HEIGHTS.length - 1)]!;
}

export interface SheetProps {
  open: boolean;
  height: SheetHeight;
  onHeightChange: (height: SheetHeight) => void;
  onClose: () => void;
  /** Names the sheet for screen readers. */
  label: string;
  children: ReactNode;
}

/**
 * Bottom sheet for phones: not modal (the canvas above stays visible), three heights, a handle to
 * drag or tap (cycles the heights), Esc closes. Focus moves in on open and back where it was on close.
 */
export function Sheet({ open, height, onHeightChange, onClose, label, children }: SheetProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={styles.sheet}
      data-height={height}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button
        type="button"
        className={styles.handle}
        aria-label={t("kit.sheetHandle")}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current && Math.abs(e.clientY - drag.current.y) > 8) drag.current.moved = true;
        }}
        onPointerUp={(e) => {
          const start = drag.current;
          drag.current = null;
          if (!start?.moved) return;
          const next = heightAfterDrag(height, e.clientY - start.y);
          if (next === null) onClose();
          else onHeightChange(next);
        }}
        onClick={() => {
          // A tap (no drag) cycles the heights.
          const i = SHEET_HEIGHTS.indexOf(height);
          onHeightChange(SHEET_HEIGHTS[(i + 1) % SHEET_HEIGHTS.length]!);
        }}
      />
      <div className={styles.sheetBody}>{children}</div>
    </div>
  );
}
