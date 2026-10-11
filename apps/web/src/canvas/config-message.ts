import type { GameConfig } from "@rave/shared/client";
import type { CanvasSize } from "./viewport";

export interface ConfigMessageDeps {
  setConfig(config: GameConfig): void;
  controller: { onConfig(config: GameConfig): void } | null;
  setCanvas(canvas: CanvasSize): void;
  applyCamera(force: boolean): void;
}

/** Handles a live `config` message: store first, then the controller, then the camera refit. */
export function applyConfigMessage(config: GameConfig, deps: ConfigMessageDeps): void {
  deps.setConfig(config);
  deps.setCanvas(config.canvas);
  deps.controller?.onConfig(config);
  deps.applyCamera(true);
}
