import { expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { gameStore } from "./game-store";

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
