import type { ConfigIssue, GameConfig } from "@rave/shared";
import type { CanvasStore } from "./canvas-store";

export type { ConfigIssue } from "@rave/shared";

/** Rules a valid config must also satisfy relative to the live game (spec 6). */
export function configChangeIssues(prev: GameConfig, next: GameConfig, canvas: CanvasStore): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (next.canvas.width < canvas.width) issues.push({ path: "canvas.width", code: "canvas_shrink", params: { current: canvas.width } });
  if (next.canvas.height < canvas.height) issues.push({ path: "canvas.height", code: "canvas_shrink", params: { current: canvas.height } });
  const nextById = new Map(next.palette.map((e) => [e.id, e]));
  for (const entry of prev.palette) {
    const used = canvas.colorCount(entry.id);
    if (used === 0) continue;
    const replacement = nextById.get(entry.id);
    if (!replacement) issues.push({ path: "palette", code: "color_in_use_removed", params: { id: entry.id, used } });
    else if (replacement.type !== entry.type) issues.push({ path: "palette", code: "color_in_use_type_changed", params: { id: entry.id } });
  }
  return issues;
}
