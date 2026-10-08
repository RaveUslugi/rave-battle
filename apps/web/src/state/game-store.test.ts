import { expect, test } from "bun:test";
import { defaultConfig, type PlayerView } from "@rave/shared";
import { createGameStore, gameStore, serverTime } from "./game-store";

test("hello fills identity, config and player", () => {
  gameStore.getState().applyHello({ type: "hello", protocol: 1, bootId: "b", user: { id: 1, name: "a" }, config: defaultConfig, player: null });
  const state = gameStore.getState();
  expect(state.bootId).toBe("b");
  expect(state.user).toEqual({ id: 1, name: "a" });
  expect(state.config?.canvas.width).toBe(512);
  expect(state.player).toBeNull();
});

test("status, online count and hover are stored", () => {
  const { setStatus, setOnline, setHover } = gameStore.getState();
  setStatus("reconnecting");
  setOnline(5);
  setHover({ x: 1, y: 2 });
  expect(gameStore.getState()).toMatchObject({ status: "reconnecting", online: 5, hover: { x: 1, y: 2 } });
});

test("the online count is cleared when the connection is lost", () => {
  const { setStatus, setOnline } = gameStore.getState();
  setStatus("open");
  setOnline(7);
  setStatus("reconnecting");
  expect(gameStore.getState().online).toBe(0);
  setStatus("open");
  expect(gameStore.getState().online).toBe(0);
});

const view = (serverNow: number) =>
  ({
    coins: 0, charges: 0, chargesUpdatedAt: 0, chargeCap: 10, frozenUntil: 0,
    inventory: { bomb: 0, detector: 0, defuser: 0 }, unlockedColors: [], dailyStep: 0,
    dailyLastClaim: null, bannedUntil: null, unlimited: false, serverNow,
  }) satisfies PlayerView;

test("player views set the clock offset; serverTime applies it", () => {
  let local = 1_000;
  const store = createGameStore(() => local);
  expect(store.getState().clockOffset).toBe(0);
  store.getState().applyHello({ type: "hello", protocol: 1, bootId: "b", user: { id: 1, name: "a" }, config: defaultConfig, player: view(6_000) });
  expect(store.getState().clockOffset).toBe(5_000);
  local = 2_000;
  store.getState().setPlayer(view(1_500));
  expect(store.getState().clockOffset).toBe(-500);
  expect(serverTime(store.getState(), 10_000)).toBe(9_500);
});

test("hello without a player keeps the offset", () => {
  const store = createGameStore(() => 0);
  store.getState().setPlayer(view(3_000));
  store.getState().applyHello({ type: "hello", protocol: 1, bootId: "b", user: null, config: defaultConfig, player: null });
  expect(store.getState().clockOffset).toBe(3_000);
});
