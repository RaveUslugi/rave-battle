import { defaultConfig, type PlayerView, type ServerMessage } from "@rave/shared";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Timers } from "../net/socket";
import { createGameStore } from "../state/game-store";
import { bindReadings, createReadingsStore } from "../state/readings-store";
import { createUiStore } from "../state/ui-store";
import { GameClient, type CanvasPort } from "./client";
import type { DetectAnswer, ToolsApi } from "./tools";

const NOW = 2_000_000;
type Placed = Extract<ServerMessage, { type: "placed" }>;

const player = (overrides: Partial<PlayerView> = {}): PlayerView => ({
  coins: 100,
  charges: 5,
  chargesUpdatedAt: NOW,
  chargeCap: 10,
  frozenUntil: 0,
  inventory: { bomb: 2, detector: 1, defuser: 1 },
  unlockedColors: [],
  dailyStep: 0,
  dailyLastClaim: null,
  bannedUntil: null,
  access: "ok",
  playableAt: null,
  unlimited: false,
  serverNow: NOW,
  ...overrides,
});

function setup(options: { sendResult?: boolean; throwOnSend?: boolean; detect?: DetectAnswer } = {}) {
  const game = createGameStore();
  const ui = createUiStore(null);
  const sent: Array<{ reqId: number; x: number; y: number; colorId: number; withBomb: boolean }> = [];
  const pendingCalls: number[] = [];
  const selections: Array<{ x: number; y: number } | null> = [];
  const flashes: Array<{ x: number; y: number }> = [];
  const port: CanvasPort = {
    sendPlace: (msg) => {
      sent.push(msg);
      if (options.throwOnSend) throw new Error("socket closed");
      return options.sendResult ?? true;
    },
    setPending: (cells) => void pendingCalls.push(cells.length),
    setSelection: (cell) => void selections.push(cell),
    flash: (cell) => void flashes.push(cell),
  };
  const timeouts: Array<() => void> = [];
  const cleared: unknown[] = [];
  const timers: Timers = { set: (fn) => timeouts.push(fn) - 1, clear: (handle) => void cleared.push(handle) };
  let now = NOW;
  const readings = createReadingsStore(null, () => now);
  bindReadings(game, readings);
  const toolCalls: string[] = [];
  const tools: ToolsApi = {
    detect: async (c) => (toolCalls.push(`detect ${c.x},${c.y}`), options.detect ?? { ok: true, count: 1 }),
    defuse: async (c) => (toolCalls.push(`defuse ${c.x},${c.y}`), { ok: true, found: false, reward: 0 }),
  };
  const client = new GameClient({ game, ui, readings, tools, now: () => now, monotonic: () => now, timers, pendingTtlMs: 10_000 });
  client.attach(port);
  game.setState({ status: "open", user: { id: 1, name: "me" }, player: player(), config: defaultConfig });
  return { game, ui, readings, toolCalls, client, sent, pendingCalls, selections, flashes, timeouts, cleared, advance: (ms: number) => void (now += ms) };
}

const placed = (reqId: number, result: Placed["result"]): Placed => ({ type: "placed", reqId, result });
const toastTexts = (ui: ReturnType<typeof createUiStore>) => ui.getState().toasts.map((t) => t.text);

describe("GameClient", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.ui.getState().selectColor(7);
  });

  test("a mouse click places immediately with the selected color", () => {
    t.client.onCellTap({ x: 10, y: 20 }, "mouse");
    expect(t.sent).toEqual([{ reqId: 1, x: 10, y: 20, colorId: 7, withBomb: false }]);
    expect(t.pendingCalls.at(-1)).toBe(1);
  });

  test("a touch tap only selects; confirming sends and clears the selection", () => {
    t.client.onCellTap({ x: 3, y: 4 }, "touch");
    expect(t.sent).toHaveLength(0);
    expect(t.ui.getState().selection).toEqual({ x: 3, y: 4 });
    expect(t.selections.at(-1)).toEqual({ x: 3, y: 4 });
    t.ui.getState().setBombMode(true);
    t.client.confirmSelection();
    expect(t.sent).toEqual([{ reqId: 1, x: 3, y: 4, colorId: 7, withBomb: true }]);
    expect(t.ui.getState().selection).toBeNull();
    expect(t.selections.at(-1)).toBeNull();
  });

  test("anonymous taps explain that login is needed and send nothing", () => {
    t.game.setState({ user: null });
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.client.onCellTap({ x: 1, y: 1 }, "touch");
    expect(t.sent).toHaveLength(0);
    expect(t.ui.getState().selection).toBeNull();
    expect(toastTexts(t.ui)).toContain("Войдите, чтобы рисовать");
  });

  test("doomed placements are refused locally and pending ones count against charges", () => {
    t.game.setState({ player: player({ charges: 1 }) });
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.client.onCellTap({ x: 2, y: 1 }, "mouse");
    expect(t.sent).toHaveLength(1);
    expect(toastTexts(t.ui)).toEqual(["Нет зарядов"]);
  });

  test("a successful answer clears the pending overlay without a toast", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.client.onPlaced(placed(1, { ok: true, outcome: "placed" }));
    expect(t.pendingCalls.at(-1)).toBe(0);
    expect(t.ui.getState().toasts).toHaveLength(0);
  });

  test("server rejects become toasts", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.client.onPlaced(placed(1, { ok: false, code: "bomb_limit" }));
    expect(toastTexts(t.ui)).toEqual(["Достигнут лимит активных бомб"]);
    expect(t.pendingCalls.at(-1)).toBe(0);
  });

  test("an explosion flashes the cell, stores the details and explains what happened", () => {
    t.client.onCellTap({ x: 9, y: 8 }, "mouse");
    t.client.onPlaced(placed(1, { ok: true, outcome: "exploded", self: false, frozenUntil: NOW + 60_000, coinsLost: 10, bombOwner: { id: 2, name: "neko" } }));
    expect(t.flashes).toEqual([{ x: 9, y: 8 }]);
    expect(t.ui.getState().explosion).toMatchObject({ self: false, coinsLost: 10, bombOwner: "neko", frozenUntil: NOW + 60_000 });
    expect(toastTexts(t.ui)[0]).toContain("neko");
    expect(toastTexts(t.ui)[0]).toContain("10");

    t.client.onCellTap({ x: 9, y: 9 }, "mouse");
    t.client.onPlaced(placed(2, { ok: true, outcome: "exploded", self: true, frozenUntil: NOW, coinsLost: 20, bombOwner: { id: 1, name: "me" } }));
    expect(toastTexts(t.ui)[1]).toContain("собственной");
    expect(toastTexts(t.ui)[0]).toContain("заморозка");
  });

  test("an explosion without a freeze does not mention one", () => {
    t.client.onCellTap({ x: 9, y: 8 }, "mouse");
    t.client.onPlaced(placed(1, { ok: true, outcome: "exploded", self: false, frozenUntil: 0, coinsLost: 0, bombOwner: { id: 2, name: "neko" } }));
    expect(toastTexts(t.ui)[0]).toBe("💥 Бомба игрока neko! −0 монет");
  });

  test("answers for unknown requests are ignored", () => {
    t.client.onPlaced(placed(99, { ok: false, code: "frozen" }));
    expect(t.ui.getState().toasts).toHaveLength(0);
  });

  test("a failed send does not leave a pending placement", () => {
    const failing = setup({ sendResult: false });
    failing.client.onCellTap({ x: 1, y: 1 }, "mouse");
    expect(toastTexts(failing.ui)).toEqual(["Сервер недоступен, попробуйте позже"]);
    failing.client.onCellTap({ x: 2, y: 1 }, "mouse");
    expect(failing.sent).toHaveLength(2);
  });

  test("unanswered placements expire", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.advance(10_001);
    t.timeouts[0]!();
    expect(toastTexts(t.ui)).toEqual(["Нет ответа от сервера"]);
    expect(t.pendingCalls.at(-1)).toBe(0);
  });

  test("losing the connection drops pending placements", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.game.getState().setStatus("reconnecting");
    expect(t.pendingCalls.at(-1)).toBe(0);
    t.client.onPlaced(placed(1, { ok: false, code: "frozen" }));
    expect(t.ui.getState().toasts).toHaveLength(0);
  });

  test("a refused confirm keeps the selection so the user can retry", () => {
    t.game.setState({ player: player({ charges: 0 }) });
    t.client.onCellTap({ x: 3, y: 4 }, "touch");
    t.client.confirmSelection();
    expect(toastTexts(t.ui)).toEqual(["Нет зарядов"]);
    expect(t.ui.getState().selection).toEqual({ x: 3, y: 4 });
    expect(t.sent).toHaveLength(0);
    t.game.setState({ player: player({ charges: 1 }) });
    t.client.confirmSelection();
    expect(t.sent).toHaveLength(1);
    expect(t.ui.getState().selection).toBeNull();
  });

  test("the selection is dropped on disconnect and on logout", () => {
    t.client.onCellTap({ x: 3, y: 4 }, "touch");
    t.game.getState().setStatus("reconnecting");
    expect(t.ui.getState().selection).toBeNull();
    t.game.getState().setStatus("open");
    t.client.onCellTap({ x: 5, y: 6 }, "touch");
    expect(t.ui.getState().selection).toEqual({ x: 5, y: 6 });
    t.game.setState({ user: null });
    expect(t.ui.getState().selection).toBeNull();
  });

  test("a throwing send is treated as a failed send", () => {
    const throwing = setup({ throwOnSend: true });
    throwing.client.onCellTap({ x: 1, y: 1 }, "mouse");
    expect(toastTexts(throwing.ui)).toEqual(["Сервер недоступен, попробуйте позже"]);
    throwing.client.onCellTap({ x: 2, y: 1 }, "mouse");
    expect(throwing.sent).toHaveLength(2);
  });

  test("detach cancels expiry timers, and a late fire does nothing", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    const callsBefore = t.pendingCalls.length;
    t.client.detach();
    expect(t.cleared).toEqual([0]);
    t.advance(10_001);
    t.timeouts[0]!();
    expect(t.ui.getState().toasts).toHaveLength(0);
    expect(t.pendingCalls).toHaveLength(callsBefore);
  });

  test("detach stops listening to the stores", () => {
    t.client.detach();
    const before = t.selections.length;
    t.ui.getState().select({ x: 1, y: 1 });
    expect(t.selections).toHaveLength(before);
  });

  test("the pre-check uses server time, so a lagging clock does not block placement", () => {
    // The local clock is 10 s behind: by server time the freeze is over.
    t.game.setState({ player: player({ frozenUntil: NOW + 5_000 }), clockOffset: 10_000 });
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    expect(t.sent).toHaveLength(1);
    expect(t.ui.getState().toasts).toHaveLength(0);
  });

  test("a late explosion is still explained; a late reject or success is silent", () => {
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    t.client.onCellTap({ x: 2, y: 1 }, "mouse");
    t.client.onCellTap({ x: 3, y: 1 }, "mouse");
    t.advance(10_001);
    t.timeouts[0]!();
    expect(toastTexts(t.ui)).toEqual(["Нет ответа от сервера"]);
    t.client.onPlaced(placed(1, { ok: false, code: "no_charges" }));
    t.client.onPlaced(placed(2, { ok: true, outcome: "placed" }));
    expect(toastTexts(t.ui)).toEqual(["Нет ответа от сервера"]);
    t.client.onPlaced(placed(3, { ok: true, outcome: "exploded", self: false, frozenUntil: NOW + 60_000, coinsLost: 10, bombOwner: { id: 2, name: "neko" } }));
    expect(t.flashes).toEqual([{ x: 3, y: 1 }]);
    expect(toastTexts(t.ui).at(-1)).toContain("neko");
  });

  test("the pending timeout runs on the monotonic clock", () => {
    let wall = NOW;
    let mono = 0;
    const timeouts: Array<() => void> = [];
    const c = new GameClient({
      game: t.game,
      ui: t.ui,
      now: () => wall,
      monotonic: () => mono,
      timers: { set: (fn) => timeouts.push(fn) - 1, clear: () => {} },
      pendingTtlMs: 10_000,
    });
    t.client.detach();
    const pendingSizes: number[] = [];
    c.attach({ sendPlace: () => true, setPending: (cells) => void pendingSizes.push(cells.length), setSelection: () => {}, flash: () => {} });
    c.onCellTap({ x: 1, y: 1 }, "mouse");
    wall -= 3_600_000; // the wall clock jumps back an hour
    mono += 10_001;
    timeouts[0]!();
    expect(pendingSizes.at(-1)).toBe(0);
  });

  test("bomb mode turns off when the last bomb is gone", () => {
    t.ui.getState().setBombMode(true);
    t.game.getState().setPlayer(player({ inventory: { bomb: 0, detector: 0, defuser: 0 } }));
    expect(t.ui.getState().bombMode).toBe(false);
  });

  test("unlimited players keep bomb mode at zero bombs", () => {
    t.ui.getState().setBombMode(true);
    t.game.getState().setPlayer(player({ unlimited: true, inventory: { bomb: 0, detector: 0, defuser: 0 } }));
    expect(t.ui.getState().bombMode).toBe(true);
  });

  test("a mouse click drops an open touch selection and acts on the clicked cell", () => {
    t.client.onCellTap({ x: 3, y: 4 }, "touch");
    t.client.onCellTap({ x: 7, y: 7 }, "mouse");
    expect(t.ui.getState().selection).toBeNull();
    expect(t.sent).toEqual([{ reqId: 1, x: 7, y: 7, colorId: 7, withBomb: false }]);
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("detector: a click uses it at once and the mode stays for the next scan", async () => {
    t.ui.getState().setTool("detector");
    t.client.onCellTap({ x: 5, y: 6 }, "mouse");
    expect(t.toolCalls).toEqual(["detect 5,6"]);
    expect(t.ui.getState().tool).toBe("detector");
    expect(t.sent).toHaveLength(0);
    await tick();
    expect(t.readings.getState().readings).toHaveLength(1);
    t.client.onCellTap({ x: 9, y: 9 }, "mouse");
    expect(t.toolCalls).toEqual(["detect 5,6", "detect 9,9"]);
  });

  test("detector by touch and defuser by any pointer wait for confirmation", async () => {
    t.ui.getState().setTool("detector");
    t.client.onCellTap({ x: 1, y: 2 }, "touch");
    expect(t.toolCalls).toEqual([]);
    t.client.confirmSelection();
    expect(t.toolCalls).toEqual(["detect 1,2"]);
    expect(t.ui.getState().selection).toBeNull();
    expect(t.ui.getState().tool).toBe("detector");
    await tick(); // one tool request at a time

    t.ui.getState().setTool("defuser");
    t.client.onCellTap({ x: 3, y: 3 }, "mouse");
    expect(t.toolCalls).toHaveLength(1);
    expect(t.ui.getState().selection).toEqual({ x: 3, y: 3 });
    t.client.confirmSelection();
    expect(t.toolCalls).toEqual(["detect 1,2", "defuse 3,3"]);
    expect(t.ui.getState().tool).toBe("paint");
  });

  test("a refused tool keeps the mode and the selection", () => {
    t.game.setState({ player: player({ inventory: { bomb: 2, detector: 1, defuser: 0 } }) });
    t.ui.getState().setTool("defuser");
    t.client.onCellTap({ x: 3, y: 3 }, "mouse");
    t.client.confirmSelection();
    expect(t.toolCalls).toEqual([]);
    expect(t.ui.getState()).toMatchObject({ tool: "defuser", selection: { x: 3, y: 3 } });
    expect(toastTexts(t.ui)).toEqual(["Дефьюзеры закончились"]);
  });

  test("logout or a user change brings the brush back", () => {
    t.ui.getState().setTool("detector");
    t.game.setState({ user: { id: 2, name: "other" } });
    expect(t.ui.getState().tool).toBe("paint");
    t.ui.getState().setTool("defuser");
    t.game.setState({ user: null });
    expect(t.ui.getState().tool).toBe("paint");
  });
});
