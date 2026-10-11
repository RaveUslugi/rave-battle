import type { GameConfig } from "@rave/shared";
import type { CanvasStore } from "./canvas-store";

export interface ConfigIssue {
  /** Dotted path like zod's: "canvas.width", "palette". */
  path: string;
  message: string;
}

/** Rules a valid config must also satisfy relative to the live game (spec 6). */
export function configChangeIssues(prev: GameConfig, next: GameConfig, canvas: CanvasStore): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (next.canvas.width < canvas.width) issues.push({ path: "canvas.width", message: `Холст может только расти (сейчас ${canvas.width})` });
  if (next.canvas.height < canvas.height) issues.push({ path: "canvas.height", message: `Холст может только расти (сейчас ${canvas.height})` });
  const nextById = new Map(next.palette.map((e) => [e.id, e]));
  for (const entry of prev.palette) {
    const used = canvas.colorCount(entry.id);
    if (used === 0) continue;
    const replacement = nextById.get(entry.id);
    if (!replacement) issues.push({ path: "palette", message: `Цвет ${entry.id} есть на холсте (${used} пикс.) — удалить нельзя` });
    else if (replacement.type !== entry.type) issues.push({ path: "palette", message: `Цвет ${entry.id} есть на холсте — менять его тип нельзя` });
  }
  return issues;
}
