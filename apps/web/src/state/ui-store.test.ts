import { describe, expect, test } from "bun:test";
import { createUiStore, DEFAULT_COLOR, type StorageLike } from "./ui-store";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("ui store", () => {
  test("the selected color defaults, persists and is restored", () => {
    const storage = memoryStorage();
    const first = createUiStore(storage);
    expect(first.getState().selectedColor).toBe(DEFAULT_COLOR);
    first.getState().selectColor(12);
    expect(storage.data["rb:color"]).toBe("12");
    expect(createUiStore(storage).getState().selectedColor).toBe(12);
  });

  test("broken or unavailable storage falls back to the default", () => {
    expect(createUiStore(memoryStorage({ "rb:color": "banana" })).getState().selectedColor).toBe(DEFAULT_COLOR);
    expect(createUiStore(memoryStorage({ "rb:color": "999" })).getState().selectedColor).toBe(DEFAULT_COLOR);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = createUiStore(throwing);
    store.getState().selectColor(7);
    expect(store.getState().selectedColor).toBe(7);
    expect(createUiStore(null).getState().selectedColor).toBe(DEFAULT_COLOR);
  });

  test("bomb mode and selection toggle independently", () => {
    const store = createUiStore(null);
    store.getState().setBombMode(true);
    store.getState().select({ x: 3, y: 4 });
    expect(store.getState()).toMatchObject({ bombMode: true, selection: { x: 3, y: 4 } });
    store.getState().select(null);
    expect(store.getState().selection).toBeNull();
  });

  test("toasts get unique ids, keep the latest four and can be dismissed", () => {
    const store = createUiStore(null);
    const ids = ["a", "b", "c", "d", "e"].map((text) => store.getState().pushToast("error", text));
    expect(new Set(ids).size).toBe(5);
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["b", "c", "d", "e"]);
    store.getState().dismissToast(ids[2]!);
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["b", "d", "e"]);
  });

  test("an explosion is stored with an id and can be cleared", () => {
    const store = createUiStore(null);
    store.getState().setExplosion({ self: false, coinsLost: 10, frozenUntil: 5, bombOwner: "neko", at: 1 });
    const first = store.getState().explosion!;
    expect(first).toMatchObject({ coinsLost: 10, bombOwner: "neko" });
    store.getState().setExplosion({ self: true, coinsLost: 20, frozenUntil: 6, bombOwner: "me", at: 2 });
    expect(store.getState().explosion!.id).toBeGreaterThan(first.id);
    store.getState().setExplosion(null);
    expect(store.getState().explosion).toBeNull();
  });

  test("a repeated toast counts up, moves to the end and gets a fresh id", () => {
    const store = createUiStore(null);
    const first = store.getState().pushToast("error", "Нет зарядов");
    store.getState().pushToast("info", "x", "detector");
    const second = store.getState().pushToast("error", "Нет зарядов");
    expect(second).not.toBe(first);
    expect(store.getState().toasts.map((t) => [t.tone, t.text, t.count, t.icon])).toEqual([
      ["info", "x", 1, "detector"],
      ["error", "Нет зарядов", 2, undefined],
    ]);
  });

  test("recent colours: newest first, no repeats, eight at most, restored with the selected colour first", () => {
    const storage = memoryStorage({ "rb:color": "3", "rb:recent-colors": '[7,3,"x",900,2]' });
    const store = createUiStore(storage);
    expect(store.getState().recentColors).toEqual([3, 7, 2]);
    for (const id of [10, 11, 12, 13, 14, 15, 2]) store.getState().selectColor(id);
    expect(store.getState().recentColors).toEqual([2, 15, 14, 13, 12, 11, 10, 3]);
    expect(createUiStore(storage).getState().recentColors).toEqual([2, 15, 14, 13, 12, 11, 10, 3]);
    expect(createUiStore(memoryStorage({ "rb:recent-colors": "{" })).getState().recentColors).toEqual([5]);
  });

  test("the shop opens on an offer; opening it from the menu drops the focus", () => {
    const store = createUiStore(null);
    store.getState().openShop("item:bomb");
    expect(store.getState()).toMatchObject({ panel: "shop", shopFocus: "item:bomb" });
    store.getState().openPanel("shop");
    expect(store.getState().shopFocus).toBeNull();
  });

  test("switching tools clears the selection", () => {
    const store = createUiStore(null);
    expect(store.getState().tool).toBe("paint");
    store.getState().select({ x: 1, y: 1 });
    store.getState().setTool("detector");
    expect(store.getState()).toMatchObject({ tool: "detector", selection: null });
  });

  test("panels open, switch and toggle closed", () => {
    const store = createUiStore(null);
    expect(store.getState().panel).toBeNull();
    store.getState().togglePanel("shop");
    expect(store.getState().panel).toBe("shop");
    store.getState().togglePanel("daily");
    expect(store.getState().panel).toBe("daily");
    store.getState().togglePanel("daily");
    expect(store.getState().panel).toBeNull();
    store.getState().togglePanel("shop");
    store.getState().closePanel();
    expect(store.getState().panel).toBeNull();
  });

  test("opening a panel never closes it", () => {
    const store = createUiStore(null);
    store.getState().openPanel("daily");
    expect(store.getState().panel).toBe("daily");
    store.getState().openPanel("daily");
    expect(store.getState().panel).toBe("daily");
    store.getState().openPanel("shop");
    expect(store.getState().panel).toBe("shop");
  });

  test("profiles open on a given player or on yourself", () => {
    const store = createUiStore(null);
    store.getState().openProfile(42);
    expect(store.getState()).toMatchObject({ panel: "profile", profileUserId: 42 });
    store.getState().openProfile(null);
    expect(store.getState()).toMatchObject({ panel: "profile", profileUserId: null });
    store.getState().openPanel("leaders");
    expect(store.getState().panel).toBe("leaders");
  });
  test("inspecting a cell drops the area", () => {
    const store = createUiStore(null);
    store.getState().setArea({ x1: 1, y1: 1, x2: 2, y2: 2 });
    store.getState().inspectCell({ x: 3, y: 4 });
    expect(store.getState().moderation).toEqual({ cell: { x: 3, y: 4 }, area: null, corner: null });
  });

  test("setting an area drops the cell and the corner", () => {
    const store = createUiStore(null);
    store.getState().inspectCell({ x: 3, y: 4 });
    store.getState().setCorner({ x: 5, y: 5 });
    store.getState().setArea({ x1: 1, y1: 1, x2: 2, y2: 2 });
    expect(store.getState().moderation).toEqual({ cell: null, area: { x1: 1, y1: 1, x2: 2, y2: 2 }, corner: null });
    store.getState().setArea(null);
    expect(store.getState().moderation.area).toBeNull();
  });

  test("inspecting a cell and switching tools drop a stale touch corner", () => {
    const store = createUiStore(null);
    store.getState().setCorner({ x: 5, y: 6 });
    store.getState().inspectCell({ x: 1, y: 1 });
    expect(store.getState().moderation).toEqual({ cell: { x: 1, y: 1 }, area: null, corner: null });
    store.getState().setCorner({ x: 5, y: 6 });
    store.getState().setTool("paint");
    expect(store.getState().moderation.corner).toBeNull();
    const before = store.getState().moderation;
    store.getState().setTool("detector");
    expect(store.getState().moderation).toBe(before);
  });

  test("the corner is remembered and cleared without touching the panel", () => {
    const store = createUiStore(null);
    store.getState().setCorner({ x: 5, y: 6 });
    expect(store.getState().moderation.corner).toEqual({ x: 5, y: 6 });
    expect(store.getState().panel).toBeNull();
    store.getState().setCorner(null);
    expect(store.getState().moderation.corner).toBeNull();
  });
});
