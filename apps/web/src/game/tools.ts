import type { StoreApi } from "zustand/vanilla";
import { serverTime, type GameState } from "../state/game-store";
import type { ReadingsState } from "../state/readings-store";
import type { UiState } from "../state/ui-store";
import { effectiveAccess } from "./access";
import { isFrozen } from "./charges";
import { formatNumber, i18n } from "../i18n";
import { rejectText } from "./messages";

type Cell = { x: number; y: number };

export type Tool = "detector" | "defuser";
export type DetectAnswer = { ok: true; count: number } | { ok: false; code: string };
export type DefuseAnswer = { ok: true; found: boolean; reward: number } | { ok: false; code: string };

/** tRPC calls for the sapper tools. Must not throw: transport failures come back as `{ ok: false, code }`. */
export interface ToolsApi {
  detect(cell: Cell): Promise<DetectAnswer>;
  defuse(cell: Cell): Promise<DefuseAnswer>;
}

export interface ToolDeps {
  game: StoreApi<GameState>;
  ui: StoreApi<UiState>;
  readings: StoreApi<ReadingsState>;
  api: ToolsApi;
  now?: () => number;
}

export function defuseText(answer: { found: boolean; reward: number }): string {
  if (!answer.found) return i18n.t("toast.defusedNone");
  return answer.reward > 0 ? i18n.t("toast.defused", { n: formatNumber(answer.reward) }) : i18n.t("toast.defusedOwn");
}

/** Detector and defuser: one request at a time; answers become toasts and stored readings. */
export class SapperTools {
  private busy = false;
  private readonly now: () => number;

  constructor(private readonly deps: ToolDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Starts the request and returns its completion, or null when refused locally (a toast explains why) or busy. */
  use(tool: Tool, cell: Cell): Promise<void> | null {
    if (this.busy) {
      this.deps.ui.getState().pushToast("info", i18n.t("toast.busy"));
      return null;
    }
    const problem = this.check(tool);
    if (problem) {
      this.toast(problem);
      return null;
    }
    this.busy = true;
    return this.run(tool, cell).finally(() => {
      this.busy = false;
    });
  }

  private check(tool: Tool): string | null {
    const game = this.deps.game.getState();
    const player = game.player;
    if (!player) return "unavailable";
    const now = serverTime(game, this.now());
    const access = effectiveAccess(player, now);
    if (access !== "ok") return access;
    if (isFrozen(player, now)) return "frozen";
    if (!player.unlimited && player.inventory[tool] < 1) return tool === "detector" ? "no_detector" : "no_defuser";
    return null;
  }

  private async run(tool: Tool, cell: Cell): Promise<void> {
    const userId = this.deps.game.getState().user?.id;
    // After a logout or account switch the answer belongs to someone else: drop it silently.
    const stale = () => this.deps.game.getState().user?.id !== userId;
    try {
      if (tool === "detector") {
        const answer = await this.deps.api.detect(cell);
        if (stale()) return;
        if (!answer.ok) return this.toast(answer.code);
        this.deps.readings.getState().add({ x: cell.x, y: cell.y, count: answer.count, at: this.now() });
        this.deps.ui.getState().pushToast("info", i18n.t("toast.detected", { count: answer.count }), "detector");
      } else {
        const answer = await this.deps.api.defuse(cell);
        if (stale()) return;
        if (!answer.ok) return this.toast(answer.code);
        this.deps.ui.getState().pushToast(answer.found ? "success" : "info", defuseText(answer), "defuser");
      }
    } catch {
      if (!stale()) this.toast("unavailable");
    }
  }

  private toast(code: string): void {
    this.deps.ui.getState().pushToast("error", rejectText(code));
  }
}
