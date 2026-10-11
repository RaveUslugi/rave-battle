import { describe, expect, test } from "bun:test";
import type { GameConfig } from "@rave/shared/client";
import { applyConfigMessage } from "./config-message";

describe("applyConfigMessage", () => {
  test("updates store, canvas size, controller and camera in order", () => {
    const calls: string[] = [];
    const config = { canvas: { width: 10, height: 20 } } as GameConfig;
    applyConfigMessage(config, {
      setConfig: (c) => calls.push(`setConfig:${c === config}`),
      setCanvas: (c) => calls.push(`setCanvas:${c.width}x${c.height}`),
      controller: { onConfig: (c) => calls.push(`onConfig:${c === config}`) },
      applyCamera: (force) => calls.push(`applyCamera:${force}`),
    });
    expect(calls).toEqual(["setConfig:true", "setCanvas:10x20", "onConfig:true", "applyCamera:true"]);
  });

  test("works without a controller", () => {
    const calls: string[] = [];
    applyConfigMessage({ canvas: { width: 1, height: 1 } } as GameConfig, {
      setConfig: () => calls.push("setConfig"),
      setCanvas: () => calls.push("setCanvas"),
      controller: null,
      applyCamera: () => calls.push("applyCamera"),
    });
    expect(calls).toEqual(["setConfig", "setCanvas", "applyCamera"]);
  });
});
