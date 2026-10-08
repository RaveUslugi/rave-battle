import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { createGameStore } from "../state/game-store";
import { createReadingsStore } from "../state/readings-store";
import { createUiStore } from "../state/ui-store";
import { defuseText, SapperTools, type DefuseAnswer, type DetectAnswer, type ToolsApi } from "./tools";

const NOW = 5_000_000;
const player = (overrides: Partial<PlayerView> = {}): PlayerView => ({
  coins: 0, charges: 5, chargesUpdatedAt: NOW, chargeCap: 10, frozenUntil: 0,
  inventory: { bomb: 0, detector: 2, defuser: 1 }, unlockedColors: [], dailyStep: 0,
  dailyLastClaim: null, bannedUntil: null, unlimited: false, serverNow: NOW, ...overrides,
});

function setup(answers: { detect?: DetectAnswer; defuse?: DefuseAnswer; throws?: boolean } = {}) {
  const game = createGameStore(() => NOW);
  game.setState({ user: { id: 1, name: "me" }, player: player(), config: defaultConfig });
  const ui = createUiStore(null);
  const readings = createReadingsStore(null, () => NOW);
  readings.getState().setUser(1);
  const calls: string[] = [];
  const api: ToolsApi = {
    detect: async (c) => {
      calls.push(`detect ${c.x},${c.y}`);
      if (answers.throws) throw new Error("network");
      return answers.detect ?? { ok: true, count: 2 };
    },
    defuse: async (c) => {
      calls.push(`defuse ${c.x},${c.y}`);
      return answers.defuse ?? { ok: true, found: true, reward: 20 };
    },
  };
  const tools = new SapperTools({ game, ui, readings, api, now: () => NOW });
  const toasts = () => ui.getState().toasts.map((t) => t.text);
  return { game, ui, readings, calls, tools, toasts };
}

describe("SapperTools", () => {
  test("a detector reading is stored and announced", async () => {
    const t = setup();
    await t.tools.use("detector", { x: 4, y: 5 });
    expect(t.calls).toEqual(["detect 4,5"]);
    expect(t.readings.getState().readings).toEqual([{ x: 4, y: 5, count: 2, at: NOW }]);
    expect(t.toasts()).toEqual(["🔍 Бомб рядом: 2"]);
  });

  test("defuse results become toasts", async () => {
    const t = setup();
    await t.tools.use("defuser", { x: 1, y: 1 });
    expect(t.toasts()).toEqual(["🧯 Бомба обезврежена! +20 монет"]);
    expect(defuseText({ found: true, reward: 0 })).toBe("🧯 Снята ваша собственная бомба");
    expect(defuseText({ found: false, reward: 0 })).toBe("Бомбы не было — дефьюзер потрачен");
  });

  test("pre-checks: no uses, frozen by server time; unlimited skips them", () => {
    const t = setup();
    t.game.setState({ player: player({ inventory: { bomb: 0, detector: 0, defuser: 0 } }) });
    expect(t.tools.use("detector", { x: 0, y: 0 })).toBeNull();
    expect(t.tools.use("defuser", { x: 0, y: 0 })).toBeNull();
    t.game.setState({ player: player({ frozenUntil: NOW + 1_000 }), clockOffset: 0 });
    expect(t.tools.use("detector", { x: 0, y: 0 })).toBeNull();
    expect(t.toasts()).toEqual(["Детекторы закончились", "Дефьюзеры закончились", "Вы заморожены"]);
    t.game.setState({ player: player({ unlimited: true, frozenUntil: NOW + 1_000, inventory: { bomb: 0, detector: 0, defuser: 0 } }) });
    expect(t.tools.use("detector", { x: 0, y: 0 })).not.toBeNull();
    expect(t.calls).toEqual(["detect 0,0"]);
  });

  test("one request at a time", async () => {
    const t = setup();
    const first = t.tools.use("detector", { x: 0, y: 0 });
    expect(t.tools.use("detector", { x: 1, y: 0 })).toBeNull();
    expect(t.toasts()).toEqual(["Подождите, предыдущий запрос ещё выполняется"]);
    await first;
    expect(t.tools.use("detector", { x: 1, y: 0 })).not.toBeNull();
    expect(t.calls).toHaveLength(2);
  });

  test("an answer that arrives after the user changed is dropped", async () => {
    const t = setup();
    const pending = t.tools.use("detector", { x: 4, y: 5 });
    t.game.setState({ user: { id: 2, name: "other" } });
    t.readings.getState().setUser(2);
    await pending;
    expect(t.readings.getState().readings).toEqual([]);
    expect(t.toasts()).toEqual([]);
  });

  test("server rejects and thrown errors become toasts and free the tool", async () => {
    const rejected = setup({ detect: { ok: false, code: "rate_limited" } });
    await rejected.tools.use("detector", { x: 0, y: 0 });
    expect(rejected.toasts()).toEqual(["Слишком часто, подождите немного"]);
    expect(rejected.readings.getState().readings).toEqual([]);
    const broken = setup({ throws: true });
    await broken.tools.use("detector", { x: 0, y: 0 });
    expect(broken.toasts()).toEqual(["Сервер недоступен, попробуйте позже"]);
    expect(broken.tools.use("detector", { x: 0, y: 0 })).not.toBeNull();
  });
});
