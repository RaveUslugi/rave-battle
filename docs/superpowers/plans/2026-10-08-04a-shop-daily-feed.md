# План 4a: магазин, дейлик, лента событий, доводка 3c — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** игрок покупает предметы, буст и цвета, забирает дейлик и видит живую ленту взрывов и обезвреживаний; детектор становится «липким»; закрыты хвосты финального ревью 3c.

**Architecture:**
- Сервер: в `Hub` кольцевой буфер последних 20 записей ленты; после `hello` клиент получает `feed_history`, затем живые `feed`. Магазин и дейлик — уже существующие tRPC-мутации (`shop.buyItem`, `shop.buyChargeBoost`, `shop.buyColor`, `daily.claim`); новое состояние игрока приходит по WebSocket (`player`), поэтому клиенту не нужен кеш запросов — **TanStack Query остаётся для 4b** (рейтинги и профиль — это запросы).
- Клиент: боковая панель с вкладками (в 4a — «Магазин», «Дейлик»; в 4b добавятся «Рейтинги», «Профиль»), кнопки в правом верхнем углу, бейдж на дейлике. Лента — компактный тикер слева над палитрой, раскрывается до 20 записей.
- `@rave/shared/client` — точка входа без zod: клиентский бандл теряет ~92 КБ.

**Tech Stack:** Bun 1.3.6, TypeScript 7, `@trpc/client` 11.19.0, React 19.3, zustand 5, PixiJS 8.22, bun test.

---

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Разбивка | 4a (этот план) + 4b (рейтинги, профиль, TanStack Query) |
| Навигация | Кнопки 🛒 📅 в правом верхнем углу → панель справа (≤ 900 px — шторка снизу), закрытие ✕, Esc или повторным нажатием кнопки. Только для вошедших |
| Лента | Тикер: последние 3 записи, свежие (< 10 с) подсвечены; кнопка «Лента» раскрывает до 20. При подключении сервер присылает последние 20 |
| Дейлик | Бейдж «!» на кнопке 📅, пока награда сегодня не забрана. Без всплывающих окон |
| Цвета | В дефолты — 8 неоновых цветов (id 32–39, `unlock: "shop"`, 200–500 монет). Клик по закрытому покупаемому цвету в палитре открывает магазин |
| Подтверждение покупок | Цена ≥ 100 — кнопка превращается в «Точно? N 🪙» на 3 с, второй клик покупает; дешевле — сразу |
| Липкий детектор | После замера режим 🔍 остаётся; выход — повторный клик по 🔍. Дефьюзер по-прежнему возвращает кисть |
| Хвосты 3c | ErrorBoundary для ленивых чанков; привязка замеров к пользователю вне `attach` + чистка ключей других аккаунтов + `count ≤ 9`; `setView` не чаще кадра и без перерисовки свёрнутой миникарты; `@rave/shared/client` без zod |

```
 ┌─ topRight ──────────────┐          ┌──────── SidePanel ─────────┐
 │ alice [Выйти]           │  click   │ [Магазин] [Дейлик]      ✕  │
 │ [🛒] [📅!]  ────────────┼────────► │ 💣 Бомба ×1   30 🪙 [Купить]│
 │ 🗺 Карта                │          │ …                          │
 └─────────────────────────┘          └────────────────────────────┘
        api.shop.* / api.daily.claim ──► tRPC ──► engine ──► WS "player" ──► HUD/панель

 Hub.handleCommit ──feed──► ring(20) ──► publish "feed"
 Hub.open ──hello──► "feed_history" (ring) ──► feedStore ──► Feed (тикер над палитрой)
```

## Файлы

Сервер/общие:
- Create `packages/shared/src/client.ts`; Modify `packages/shared/package.json` (exports), `packages/shared/src/config/defaults.ts`, `packages/shared/src/config/schema.test.ts`, `packages/shared/src/protocol.ts`.
- Modify `apps/server/src/net/hub.ts`, `apps/server/src/net/server.test.ts`.
- Create `apps/server/src/scripts/push-default-config.ts`; Modify root `package.json` (скрипт `config:defaults`).

Клиент:
- Modify все `apps/web/src/**` (не тесты), импортирующие `@rave/shared` → `@rave/shared/client`.
- Modify `apps/web/src/game/client.ts` (+test) — липкий детектор, замеры вне `attach`.
- Modify `apps/web/src/state/readings-store.ts` (+test) — `bindReadings`, чистка, `count ≤ 9`.
- Create `apps/web/src/ui/ChunkBoundary.tsx`, `ChunkBoundary.module.css`.
- Modify `apps/web/src/canvas/session.ts`, `apps/web/src/ui/Minimap.tsx`.
- Create `apps/web/src/state/feed-store.ts` (+test), `apps/web/src/ui/Feed.tsx`, `Feed.module.css`.
- Modify `apps/web/src/net/api.ts`; Create `apps/web/src/net/api.test.ts`; Modify `apps/web/src/game/messages.ts`.
- Modify `apps/web/src/state/ui-store.ts` (+test) — `panel`.
- Create `apps/web/src/ui/PanelMenu.tsx`, `PanelMenu.module.css`, `SidePanel.tsx`, `SidePanel.module.css`, `ShopTab.tsx`, `DailyTab.tsx`, `Tabs.module.css`; Create `apps/web/src/game/shop.ts` (+test), `apps/web/src/game/daily.ts` (+test).
- Modify `apps/web/src/ui/PaletteBar.tsx`, `apps/web/src/App.tsx`, `App.module.css`.
- Modify `docs/superpowers/plans/2026-10-07-00-roadmap.md`.

Проверки из корня: `bun test` (Postgres: `bun run db:up`), `bun run typecheck`, `bun run build:web`.

---

### Task 1: Липкий детектор

**Files:** Modify `apps/web/src/game/client.ts`, `apps/web/src/game/client.test.ts`

- [ ] **Step 1: Тест.** В `client.test.ts` тест «detector: a click uses it at once and returns to the brush» переименовать и изменить ожидание:

```ts
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
```

В тесте «detector by touch and defuser by any pointer wait for confirmation» после первого `confirmSelection()` ожидать `tool` = `"detector"` (если там есть проверка на `"paint"` после детектора — заменить), а после дефьюзера — по-прежнему `"paint"`.

- [ ] **Step 2:** `bun test apps/web/src/game/client.test.ts` → FAIL.

- [ ] **Step 3: `client.ts` `useTool`.**

```ts
  /** True when the request was sent. The detector stays picked for scanning an area; the costly defuser hands back the brush. */
  private useTool(tool: Tool, cell: Cell): boolean {
    if (!this.sapper) {
      this.toast("unavailable");
      return false;
    }
    if (!this.sapper.use(tool, cell)) return false;
    if (tool === "defuser") this.deps.ui.getState().setTool("paint");
    return true;
  }
```

Для касания детектор после подтверждения тоже остаётся — `confirmSelection` уже сбрасывает выбор, следующий тап снова выбирает клетку.

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/game
git commit -m "feat(web): keep the detector picked after a scan"
```

---

### Task 2: `@rave/shared/client` без zod

`@rave/shared` реэкспортирует `config/schema.ts`, где zod-схемы создаются на верхнем уровне модуля — бандлер не может их выбросить, и zod (~92 КБ) попадает в клиент. Отдельная точка входа отдаёт только то, что нужно браузеру.

**Files:** Create `packages/shared/src/client.ts`; Modify `packages/shared/package.json`, все не-тестовые файлы `apps/web/src`, импортирующие `@rave/shared`

- [ ] **Step 1: Замер до.** `bun run build:web 2>&1 | tail -20` — записать размеры чанков (особенно `palette-*.js`, ~92 КБ — это zod).

- [ ] **Step 2: `packages/shared/src/client.ts`**

```ts
/**
 * Browser entry point: everything the web client needs, without the zod config schema
 * (its schemas are built at module load, so bundlers cannot tree-shake zod away).
 */
export * from "./constants";
export * from "./time";
export * from "./protocol";
export type { GameConfig, ItemKey, PaletteEntry, Reward } from "./config/schema";
```

`packages/shared/package.json`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts"
  },
```

- [ ] **Step 3: Переключить импорты.** Во всех файлах `apps/web/src/**/*.{ts,tsx}`, кроме `*.test.ts`, заменить `from "@rave/shared"` на `from "@rave/shared/client"` (список: `net/socket.ts`, `game/placement.ts`, `game/charges.ts`, `game/client.ts`, `state/game-store.ts`, `canvas/chunk-sync.ts`, `canvas/chunk-loader.ts`, `canvas/pixi-renderer.ts`, `canvas/session.ts`, `canvas/viewport.ts`, `canvas/controller.ts`, `canvas/palette.ts`; найти остальные `grep -rn '"@rave/shared"' apps/web/src | grep -v test`). Тесты могут дальше брать `defaultConfig` из `@rave/shared`.

Проверить, что `protocol.ts`, `time.ts`, `constants.ts` не импортируют `config/schema` в рантайме (только `import type`): `grep -n "import" packages/shared/src/{protocol,time,constants}.ts`.

- [ ] **Step 4: Проверка.**

```bash
bun run typecheck && bun test apps/web && bun run build:web 2>&1 | tail -20
grep -l "ZodError\|_zod" apps/web/dist/assets/*.js || echo "no zod in the bundle"
```

Expected: typecheck и тесты зелёные, чанк `palette-*.js` (zod) исчез, grep печатает `no zod in the bundle`. Если zod остался — найти, кто его тянет (`grep -rn "@rave/shared\"" apps/web/src`), и исправить.

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/web/src
git commit -m "perf(web): import shared code through a zod-free client entry"
```

---

### Task 3: Замеры: привязка вне `attach`, чистка, `count ≤ 9`

Сейчас `readings.setUser` вызывается только в `GameClient.attach` — если ленивый чанк холста не загрузился, `StatusBar` не получит замеры. Замеры других аккаунтов на общем устройстве не чистятся.

**Files:** Modify `apps/web/src/state/readings-store.ts`, `readings-store.test.ts`, `apps/web/src/game/client.ts`, `client.test.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Тесты.** В `readings-store.test.ts` расширить `memoryStorage` до `ReadingsStorage` (ниже) и добавить:

```ts
function memoryStorage(initial: Record<string, string> = {}): ReadingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
    key: (i) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
}

  test("switching users sweeps other accounts' keys that hold nothing fresh", () => {
    const now = READING_TTL_MS * 3;
    const storage = memoryStorage({
      "rb:readings:2": JSON.stringify([{ x: 0, y: 0, count: 1, at: 0 }]), // expired
      "rb:readings:3": JSON.stringify([{ x: 0, y: 0, count: 1, at: now }]), // fresh: kept
      "rb:readings:4": "{broken",
      "rb:color": "5", // not ours
    });
    const store = createReadingsStore(storage, () => now);
    store.getState().setUser(1);
    expect(Object.keys(storage.data).sort()).toEqual(["rb:color", "rb:readings:3"]);
  });

  test("counts above 9 are rejected as malformed", () => {
    const storage = memoryStorage({ "rb:readings:1": JSON.stringify([{ x: 0, y: 0, count: 10, at: 0 }]) });
    const store = createReadingsStore(storage, () => 0);
    store.getState().setUser(1);
    expect(store.getState().readings).toEqual([]);
  });

describe("bindReadings", () => {
  test("follows the game store's user, including the current one", () => {
    const game = createGameStore(() => 0);
    game.setState({ user: { id: 5, name: "a" } });
    const readings = createReadingsStore(null, () => 0);
    const unbind = bindReadings(game, readings);
    expect(readings.getState().userId).toBe(5);
    game.setState({ user: null });
    expect(readings.getState().userId).toBeNull();
    unbind();
    game.setState({ user: { id: 6, name: "b" } });
    expect(readings.getState().userId).toBeNull();
  });
});
```

(импорты: `bindReadings`, `type ReadingsStorage` из `./readings-store`, `createGameStore` из `./game-store`). Существующий тест «broken storage…» использует объект `throwing: StorageLike` — дополнить его `removeItem`, `key`, `length` (всё бросает/0).

В `client.test.ts` удалить тест «readings follow the logged-in user» (поведение переезжает в `bindReadings`).

- [ ] **Step 2:** `bun test apps/web/src/state` → FAIL.

- [ ] **Step 3: `readings-store.ts`.**

```ts
import type { StoreApi } from "zustand/vanilla";
import type { GameState } from "./game-store";
import { browserStorage } from "./ui-store";

export type ReadingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const KEY_PREFIX = "rb:readings:";
const keyOf = (userId: number) => `${KEY_PREFIX}${userId}`;
/** A 3×3 square holds at most 9 bombs. */
const MAX_COUNT = 9;
```

`isReading`: условие `r.count >= 0` → `r.count >= 0 && r.count <= MAX_COUNT`.

`createReadingsStore(storage: ReadingsStorage | null, clock = Date.now)` — добавить чистку и вызывать её в `setUser` для ненулевого пользователя:

```ts
  /** Drops other accounts' keys with nothing fresh left: a shared device should not keep them forever. */
  const sweep = (userId: number) => {
    try {
      if (!storage) return;
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(KEY_PREFIX) && key !== keyOf(userId)) keys.push(key);
      }
      for (const key of keys) {
        let keep = false;
        try {
          const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
          keep = Array.isArray(parsed) && fresh(parsed.filter(isReading), clock()).length > 0;
        } catch {
          keep = false;
        }
        if (!keep) storage.removeItem(key);
      }
    } catch {
      // Blocked storage: nothing to sweep.
    }
  };
```

```ts
    setUser: (userId) => {
      if (userId === get().userId) return;
      if (userId !== null) sweep(userId);
      set({ userId, readings: userId === null ? [] : load(userId) });
    },
```

Новая функция:

```ts
/** Keeps the readings store on the logged-in user. Independent of the canvas, so it works even if the canvas chunk fails to load. */
export function bindReadings(game: StoreApi<GameState>, readings: StoreApi<ReadingsState>): () => void {
  readings.getState().setUser(game.getState().user?.id ?? null);
  return game.subscribe((state, prev) => {
    if (state.user?.id !== prev.user?.id) readings.getState().setUser(state.user?.id ?? null);
  });
}
```

`browserStorage()` в `ui-store.ts` возвращает `Storage` — подходит под оба типа (если тип возврата объявлен как `StorageLike | null`, расширить до `Storage | null`).

Цикл импортов `readings-store → game-store`: `game-store` не импортирует `readings-store`, цикла нет; импорт типа — `import type`.

- [ ] **Step 4: `client.ts`** — убрать оба вызова `this.deps.readings?.getState().setUser(...)` (в `attach` и в подписке); сброс инструмента при смене пользователя оставить. `readings` в `ClientDeps` по-прежнему нужен для `SapperTools`.

`App.tsx`:

```tsx
import { bindReadings, readingsStore } from "./state/readings-store";
// …
  useEffect(() => bindReadings(gameStore, readingsStore), []);
```

- [ ] **Step 5:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): bind readings to the user outside the canvas and sweep stale accounts"
```

---

### Task 4: ErrorBoundary для ленивых чанков

Сбой загрузки чанка (например, после деплоя старые хеши файлов исчезли) сейчас роняет всё дерево React — пустая страница.

**Files:** Create `apps/web/src/ui/ChunkBoundary.tsx`, `ChunkBoundary.module.css`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: `ChunkBoundary.tsx`**

```tsx
import { Component, type ReactNode } from "react";
import styles from "./ChunkBoundary.module.css";

interface Props {
  children: ReactNode;
  /** Shown instead of the children after a failure; null hides the area silently. */
  fallback: "reload" | null;
}

/**
 * Catches render and lazy-import failures of one area (e.g. a chunk removed by a deploy) so the
 * rest of the interface keeps working.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("Interface part failed to load", error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback === null) return null;
    return (
      <div className={styles.reload} role="alert">
        <p>Не удалось загрузить холст. Возможно, игра обновилась.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    );
  }
}
```

`ChunkBoundary.module.css`:

```css
.reload {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
  padding: 16px;
}

.reload button {
  justify-self: center;
  min-height: 44px;
  padding: 0 16px;
  background: var(--panel);
  border: 1px solid var(--neon-cyan);
  border-radius: var(--radius);
  box-shadow: var(--glow-cyan);
  cursor: pointer;
}
```

- [ ] **Step 2: `App.tsx`** — обернуть:

```tsx
      <ChunkBoundary fallback="reload">
        <Suspense fallback={null}>
          <CanvasView client={client} />
        </Suspense>
      </ChunkBoundary>
```

```tsx
          <ChunkBoundary fallback={null}>
            <Suspense fallback={null}>
              <Minimap />
            </Suspense>
          </ChunkBoundary>
```

- [ ] **Step 3: Проверка.** `bun run typecheck && bun run build:web`. Ручная проверка — в Task 13 (в DevTools заблокировать запрос `CanvasView-*.js` → видна кнопка «Обновить страницу», остальной UI работает).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): show a reload prompt instead of a blank page when a chunk fails"
```

---

### Task 5: Миникарта не перерисовывается вхолостую

`setView` вызывается на каждое событие указателя, а `Minimap` подписан на `view` даже в свёрнутом виде.

**Files:** Modify `apps/web/src/canvas/session.ts`, `apps/web/src/ui/Minimap.tsx`

- [ ] **Step 1: `session.ts`** — публиковать вид не чаще кадра:

```ts
  private viewFrame: number | null = null;
```

В `applyCamera` вместо `gameStore.getState().setView({ camera: this.camera, screen: size });`:

```ts
    // The minimap needs at most one update per frame; pointer events can fire more often.
    if (this.viewFrame === null) {
      this.viewFrame = requestAnimationFrame(() => {
        this.viewFrame = null;
        if (this.camera && !this.disposed) gameStore.getState().setView({ camera: this.camera, screen: this.renderer.screenSize() });
      });
    }
```

В `dispose()`: `if (this.viewFrame !== null) cancelAnimationFrame(this.viewFrame);`.

- [ ] **Step 2: `Minimap.tsx`** — вынести карту в дочерний компонент, который подписан на `view` и монтируется только в раскрытом виде. Внешний `Minimap` хранит `open`, `image` и загрузку; внутренний `MinimapMap` получает `layout`, `image`, `config.canvas` пропсами и сам читает `useGame((s) => s.view)`, рисует и обрабатывает указатель (перенести туда `mapRef`, эффект рисования и `jump`). У внешнего убрать `useGame((s) => s.view)`.

```tsx
function MinimapMap({ layout, image, canvas }: { layout: MinimapLayout; image: HTMLCanvasElement | null; canvas: CanvasSize }) {
  const view = useGame((s) => s.view);
  const mapRef = useRef<HTMLCanvasElement>(null);
  // эффект рисования — без изменений, зависимости [layout, view, image]
  // jump — без изменений, использует canvas
  return <canvas ref={mapRef} … />; // атрибуты и обработчики как сейчас
}
```

и в `Minimap`: `{open && <MinimapMap layout={layout} image={image} canvas={config.canvas} />}` (импорт типов `MinimapLayout` из `../canvas/minimap-math`, `CanvasSize` из `../canvas/viewport`).

- [ ] **Step 3:** `bun run typecheck && bun test apps/web && bun run build:web` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/canvas/session.ts apps/web/src/ui/Minimap.tsx
git commit -m "perf(web): publish the view once per frame and skip a collapsed minimap"
```

---

### Task 6: Платные цвета в дефолтах и скрипт обновления конфига

**Files:** Modify `packages/shared/src/config/defaults.ts`, `packages/shared/src/config/schema.test.ts`; Create `apps/server/src/scripts/push-default-config.ts`; Modify root `package.json`

- [ ] **Step 1: Тест** в `schema.test.ts`: строку `expect(defaultConfig.palette).toHaveLength(32);` заменить на:

```ts
    expect(defaultConfig.palette).toHaveLength(40);
    const shop = defaultConfig.palette.filter((e) => e.unlock === "shop");
    expect(shop.map((e) => e.id)).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
    expect(shop.every((e) => e.price !== undefined && e.price >= 200 && e.price <= 500)).toBe(true);
```

Тесты, рассчитывающие на индекс 32 для добавленной записи (`"palette.32.id"`), исправить на `palette.40.id` (индекс = длина массива до `push`). Тест с `id: 40` в той же функции заменить на `id: 41`.

- [ ] **Step 2:** `bun test packages` → FAIL.

- [ ] **Step 3: `defaults.ts`**

```ts
/** Neon extras sold in the shop (slots 32–39). */
const SHOP_COLORS: Array<[base: string, price: number]> = [
  ["#FF00E5", 200],
  ["#00FFF0", 200],
  ["#39FF14", 250],
  ["#FFF01F", 250],
  ["#FF5F1F", 300],
  ["#BC13FE", 350],
  ["#FF073A", 400],
  ["#04D9FF", 500],
];
```

```ts
  palette: [
    ...BASE_COLORS.map((base, id): PaletteEntry => ({ id, type: "solid", base, params: {}, unlock: "default" })),
    ...SHOP_COLORS.map(
      ([base, price], i): PaletteEntry => ({ id: BASE_COLORS.length + i, type: "solid", base, params: {}, unlock: "shop", price }),
    ),
  ],
```

- [ ] **Step 4: Скрипт.** Сервер берёт конфиг из таблицы `game_config` (последняя версия), а дефолт пишет туда только при пустой таблице. Dev-база уже содержит версию — новые цвета появятся только после новой версии. До админки (План 5):

`apps/server/src/scripts/push-default-config.ts`:

```ts
import { defaultConfig, gameConfigSchema } from "@rave/shared";
import { createDb } from "../db/client";
import { gameConfig } from "../db/schema";

/**
 * Dev helper until the config editor exists (plan 5): stores the current code defaults as the newest
 * config version. The running server picks it up on restart.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, close } = createDb(url);
const data = gameConfigSchema.parse(defaultConfig);
const [row] = await db.insert(gameConfig).values({ data, comment: "defaults from code" }).returning({ version: gameConfig.version });
console.log(`Stored config version ${row!.version}; restart the server to apply it.`);
await close();
```

(Свериться с сигнатурой `createDb` в `apps/server/src/db/client.ts` — возвращает `{ db, close }`; если `close` синхронный или называется иначе — поправить.)

Корневой `package.json`, `scripts`: `"config:defaults": "bun apps/server/src/scripts/push-default-config.ts"`. Bun сам читает `.env` из корня.

**Важно:** расширение палитры не уменьшает холст и не меняет id базовых цветов — совместимо с уже сохранёнными пикселями.

- [ ] **Step 5:** `bun test && bun run typecheck` → PASS. Скрипт **не** запускать в рамках задачи (его запускает контроллер при ручной проверке).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config apps/server/src/scripts package.json
git commit -m "feat(config): sell eight neon colors and add a dev script to store default config"
```

---

### Task 7: История ленты на сервере

**Files:** Modify `packages/shared/src/protocol.ts`, `apps/server/src/net/hub.ts`, `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тест** в `server.test.ts` (`describe("websocket")`):

```ts
  test("new connections get the recent feed right after hello", async () => {
    const alice = await connect(await login("alice"));
    const bob = await connect(await login("bob"));
    alice.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(alice, 1);
    bob.ws.send(encodePlace({ reqId: 2, x: 5, y: 5, colorId: 9, withBomb: false }));
    await placed(bob, 2);
    await waitFor(() => bob.json.find((m) => m.type === "feed"));

    const late = await connect();
    const history = await waitFor(() => late.json.find((m): m is Extract<ServerMessage, { type: "feed_history" }> => m.type === "feed_history"));
    expect(late.json[0]?.type).toBe("hello");
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ type: "feed", kind: "exploded", actor: { name: "bob" }, owner: { name: "alice" } });
    expect(Object.keys(history.entries[0]!).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);
  });

  test("the feed history keeps the latest 20 entries", async () => {
    const owner = await connect(await login("owner"));
    const victim = await connect(await login("victim"));
    for (let i = 0; i < 22; i++) {
      await runtime.run((engine) => {
        const o = engine.players.get(hello(owner).user!.id);
        const v = engine.players.get(hello(victim).user!.id);
        o.inventory.bomb = 1;
        o.charges = 10;
        v.charges = 10;
        v.frozenUntil = 0;
      });
      owner.ws.send(encodePlace({ reqId: 100 + i * 2, x: i, y: 10, colorId: 3, withBomb: true }));
      await placed(owner, 100 + i * 2);
      victim.ws.send(encodePlace({ reqId: 101 + i * 2, x: i, y: 10, colorId: 4, withBomb: false }));
      await placed(victim, 101 + i * 2);
    }
    const late = await connect();
    const history = await waitFor(() => late.json.find((m): m is Extract<ServerMessage, { type: "feed_history" }> => m.type === "feed_history"));
    expect(history.entries).toHaveLength(20);
  });
```

(Если заряды/лимит сообщений мешают 22 итерациям — в этом тесте стартовать сервер с `start({ hub: { messageRate: { capacity: 1000, perSecond: 1000 } } })` и через `runtime.run` выставлять `charges` обоим игрокам; при необходимости уменьшить до 21 итерации — суть в том, что старше 20 обрезается. Хелпер `hello(client)` уже есть в файле.)

- [ ] **Step 2:** `bun test apps/server/src/net/server.test.ts` → FAIL.

- [ ] **Step 3: Реализация.** `protocol.ts`, в `ServerMessage`:

```ts
  /** Sent once right after `hello`: the latest feed entries, oldest first. Replaces whatever the client showed before. */
  | { type: "feed_history"; entries: Array<Extract<ServerMessage, { type: "feed" }>> }
```

(Если рекурсивная ссылка на `ServerMessage` внутри собственного объявления не компилируется — вынести `export type FeedMessage = { type: "feed"; kind: "exploded" | "defused"; actor: UserRef; owner: UserRef; at: number }` и использовать его в обоих вариантах.)

`hub.ts`:

```ts
/** How many feed entries a new connection gets right after hello. */
const FEED_HISTORY = 20;
// поле класса:
  private readonly feedHistory: FeedMessage[] = [];
```

В `handleCommit` цикл ленты:

```ts
    for (const entry of buildFeed(events, this.options.users)) {
      this.feedHistory.push(entry);
      if (this.feedHistory.length > FEED_HISTORY) this.feedHistory.shift();
      server.publish(GLOBAL_TOPIC, JSON.stringify(entry));
    }
```

В `open()` сразу после `send(ws, { type: "hello", … })`:

```ts
    send(ws, { type: "feed_history", entries: [...this.feedHistory] });
```

(Тип `FeedMessage` — из `@rave/shared` или `Extract<ServerMessage, { type: "feed" }>`.)

- [ ] **Step 4:** `bun test apps/server && bun run typecheck` → PASS. Убедиться, что существующие тесты, которые проверяют порядок/число JSON-сообщений после `hello` (например, `json[1]`), не сломались; если сломались — учесть новое сообщение в ожиданиях.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts apps/server/src/net
git commit -m "feat(server): send recent feed entries to new connections"
```

---

### Task 8: Лента на клиенте

**Files:** Create `apps/web/src/state/feed-store.ts`, `feed-store.test.ts`, `apps/web/src/ui/Feed.tsx`, `Feed.module.css`; Modify `apps/web/src/canvas/session.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Тест `feed-store.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { createFeedStore, feedText, FEED_LIMIT } from "./feed-store";

const entry = (actor: string, owner: string, kind: "exploded" | "defused" = "exploded", at = 1) =>
  ({ type: "feed", kind, actor: { id: actor.length, name: actor }, owner: { id: owner.length, name: owner }, at }) as const;

describe("feed store", () => {
  test("history replaces, live entries append, both keep the latest FEED_LIMIT with fresh ids", () => {
    const store = createFeedStore();
    store.getState().replace([entry("a", "bb")]);
    store.getState().push(entry("ccc", "dddd"));
    const ids = store.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    store.getState().replace([entry("x", "yy")]);
    expect(store.getState().entries.map((e) => e.actor.name)).toEqual(["x"]);
    for (let i = 0; i < FEED_LIMIT + 5; i++) store.getState().push(entry("a", "bb", "defused", i));
    expect(store.getState().entries).toHaveLength(FEED_LIMIT);
    expect(store.getState().entries.at(-1)?.at).toBe(FEED_LIMIT + 4);
  });

  test("texts", () => {
    expect(feedText(entry("bob", "alice"))).toBe("💥 bob подорвался на бомбе alice");
    expect(feedText({ ...entry("bob", "bob"), owner: { id: 3, name: "bob" }, actor: { id: 3, name: "bob" } })).toBe("💥 bob подорвался на своей бомбе");
    expect(feedText(entry("eve", "alice", "defused"))).toBe("🧯 eve обезвредил бомбу alice");
    expect(feedText({ ...entry("eve", "eve", "defused"), owner: { id: 3, name: "eve" }, actor: { id: 3, name: "eve" } })).toBe("🧯 eve снял свою бомбу");
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `feed-store.ts`**

```ts
import type { ServerMessage } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

type FeedMessage = Extract<ServerMessage, { type: "feed" }>;
export type FeedEntry = FeedMessage & { id: number };

export const FEED_LIMIT = 20;

export interface FeedState {
  /** Oldest first. */
  entries: FeedEntry[];
  replace(entries: FeedMessage[]): void;
  push(entry: FeedMessage): void;
}

export function createFeedStore() {
  let nextId = 1;
  const withId = (m: FeedMessage): FeedEntry => ({ ...m, id: nextId++ });
  return createStore<FeedState>()((set) => ({
    entries: [],
    replace: (entries) => set({ entries: entries.slice(-FEED_LIMIT).map(withId) }),
    push: (entry) => set((s) => ({ entries: [...s.entries, withId(entry)].slice(-FEED_LIMIT) })),
  }));
}

/** Who and whose bomb — never where. */
export function feedText(e: FeedMessage): string {
  const own = e.actor.id === e.owner.id;
  if (e.kind === "exploded") return own ? `💥 ${e.actor.name} подорвался на своей бомбе` : `💥 ${e.actor.name} подорвался на бомбе ${e.owner.name}`;
  return own ? `🧯 ${e.actor.name} снял свою бомбу` : `🧯 ${e.actor.name} обезвредил бомбу ${e.owner.name}`;
}

export const feedStore = createFeedStore();

export function useFeed<T>(selector: (state: FeedState) => T): T {
  return useStore(feedStore, selector);
}
```

`session.ts` `onMessage` — вместо комментария `// "feed" — Plan 4.`:

```ts
    else if (message.type === "feed") feedStore.getState().push(message);
    else if (message.type === "feed_history") feedStore.getState().replace(message.entries);
```

(Сейчас сообщения приходят через `CanvasSession`; если холст не загрузился — ленты нет, это приемлемо: без холста нет и сокета.)

`ui/Feed.tsx`:

```tsx
import { useState } from "react";
import { useNow } from "../hooks/useNow";
import { feedText, useFeed } from "../state/feed-store";
import styles from "./Feed.module.css";

const COLLAPSED = 3;
const FRESH_MS = 10_000;
const time = (at: number) => new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Explosions and defuses without coordinates: the latest few, expandable to the full history. */
export function Feed() {
  const entries = useFeed((s) => s.entries);
  const [open, setOpen] = useState(false);
  const now = useNow(1_000);
  if (entries.length === 0) return null;
  const shown = open ? entries : entries.slice(-COLLAPSED);
  return (
    <section className={styles.feed} aria-label="Лента событий">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        Лента {open ? "▾" : "▸"}
      </button>
      <ol className={open ? styles.listOpen : styles.list}>
        {shown.map((e) => (
          // `at` is server time; a few seconds of clock skew only affects the highlight.
          <li key={e.id} className={now - e.at < FRESH_MS ? styles.fresh : styles.item}>
            <time className={styles.time}>{time(e.at)}</time> {feedText(e)}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

`Feed.module.css`:

```css
.feed {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(100%, 340px);
  padding: 6px 10px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  backdrop-filter: blur(6px);
  font-size: 13px;
}

.toggle {
  align-self: flex-start;
  min-height: 28px;
  padding: 0 4px;
  background: none;
  border: none;
  color: var(--neon-cyan);
  cursor: pointer;
}

.list,
.listOpen {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.listOpen {
  max-height: 40vh;
  overflow-y: auto;
}

.item {
  opacity: 0.6;
}

.fresh {
  opacity: 1;
  color: var(--neon-pink);
}

.time {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
```

`App.tsx` — `<Feed />` первым ребёнком `.bottom` (перед `ConfirmBar`).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): show the event feed above the palette"
```

---

### Task 9: API магазина и дейлика, тексты ошибок

**Files:** Modify `apps/web/src/net/api.ts`, `apps/web/src/game/messages.ts`; Create `apps/web/src/net/api.test.ts`

- [ ] **Step 1: Тест `api.test.ts`** — проверка маппинга ошибок (пункт ревью 3c). `call` экспортировать для теста.

```ts
import { describe, expect, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { call } from "./api";

const trpcError = (code: string) =>
  TRPCClientError.from({ error: { message: "x", code: -32000, data: { code, httpStatus: 429 } } });

describe("call", () => {
  test("passes results through", async () => {
    expect(await call(async () => ({ ok: true as const }))).toEqual({ ok: true });
  });

  test("maps tRPC and transport errors to codes", async () => {
    expect(await call(() => Promise.reject(trpcError("TOO_MANY_REQUESTS")))).toEqual({ ok: false, code: "rate_limited" });
    expect(await call(() => Promise.reject(trpcError("UNAUTHORIZED")))).toEqual({ ok: false, code: "unauthorized" });
    expect(await call(() => Promise.reject(trpcError("INTERNAL_SERVER_ERROR")))).toEqual({ ok: false, code: "unavailable" });
    expect(await call(() => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, code: "unavailable" });
  });
});
```

(Свериться с типами `TRPCClientError.from` в `node_modules/@trpc/client` 11.19.0: если сигнатура отличается — построить ошибку так, чтобы `error.data.code` был заданным кодом; суть теста — контракт `data.code`.)

- [ ] **Step 2:** FAIL (`call` не экспортирован).

- [ ] **Step 3: `api.ts`** — `async function call` → `export async function call`; добавить:

```ts
import type { ItemKey, Reward } from "@rave/shared/client";

export type BuyAnswer = { ok: true } | { ok: false; code: string };
export type ClaimAnswer = { ok: true; reward: Reward } | { ok: false; code: string };

/** Never throw: transport failures come back as `{ ok: false, code }` like engine rejects. */
export const shopApi = {
  buyItem: (item: ItemKey): Promise<BuyAnswer> => call(() => trpc.shop.buyItem.mutate({ item })),
  buyChargeBoost: (): Promise<BuyAnswer> => call(() => trpc.shop.buyChargeBoost.mutate()),
  buyColor: (colorId: number): Promise<BuyAnswer> => call(() => trpc.shop.buyColor.mutate({ colorId })),
};

export const dailyApi = {
  claim: (): Promise<ClaimAnswer> => call(() => trpc.daily.claim.mutate()),
};
```

`messages.ts` — добавить коды:

```ts
  insufficient_coins: "Не хватает монет",
  boost_limit: "Достигнут максимум буста зарядов",
  not_for_sale: "Этот товар не продаётся",
  already_unlocked: "Этот цвет уже открыт",
  already_claimed: "Награда за сегодня уже получена",
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/net apps/web/src/game/messages.ts
git commit -m "feat(web): add shop and daily API calls with tested error mapping"
```

---

### Task 10: Боковая панель и меню

**Files:** Modify `apps/web/src/state/ui-store.ts`, `ui-store.test.ts`, `apps/web/src/App.tsx`, `App.module.css`; Create `apps/web/src/game/daily.ts`, `daily.test.ts`, `apps/web/src/ui/PanelMenu.tsx`, `PanelMenu.module.css`, `SidePanel.tsx`, `SidePanel.module.css`

- [ ] **Step 1: Тесты.**

`ui-store.test.ts`:

```ts
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
```

`daily.test.ts`:

```ts
import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { dailyState } from "./daily";

// 2026-10-08 12:00 UTC = 15:00 Moscow.
const NOON = Date.UTC(2026, 9, 8, 12);
const player = (dailyStep: number, dailyLastClaim: string | null) => ({ dailyStep, dailyLastClaim }) as Pick<PlayerView, "dailyStep" | "dailyLastClaim">;

describe("dailyState", () => {
  test("available when not claimed today in the config time zone", () => {
    expect(dailyState(player(2, "2026-10-07"), defaultConfig, NOON)).toEqual({ claimedToday: false, step: 2 });
    expect(dailyState(player(3, "2026-10-08"), defaultConfig, NOON)).toEqual({ claimedToday: true, step: 3 });
  });

  test("the day turns at midnight Moscow time, not UTC", () => {
    const lateUtc = Date.UTC(2026, 9, 8, 21, 30); // 00:30 on the 9th in Moscow
    expect(dailyState(player(3, "2026-10-08"), defaultConfig, lateUtc).claimedToday).toBe(false);
  });

  test("a step beyond a shortened reward list wraps", () => {
    expect(dailyState(player(9, null), defaultConfig, NOON).step).toBe(2);
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.**

`game/daily.ts`:

```ts
import { dateKey, type GameConfig, type PlayerView } from "@rave/shared/client";

/** Whether today's reward is taken and which reward is next. `now` must be server time. */
export function dailyState(
  player: Pick<PlayerView, "dailyStep" | "dailyLastClaim">,
  config: Pick<GameConfig, "daily">,
  now: number,
): { claimedToday: boolean; step: number } {
  return {
    claimedToday: player.dailyLastClaim === dateKey(now, config.daily.timezone),
    // Same wrap as the engine: config edits may shorten the list.
    step: player.dailyStep % config.daily.rewards.length,
  };
}
```

`ui-store.ts`:

```ts
export type Panel = "shop" | "daily";
// в UiState:
  /** The side panel tab, or null when closed. */
  panel: Panel | null;
  togglePanel(panel: Panel): void;
  closePanel(): void;
// в createUiStore:
    panel: null,
    togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
    closePanel: () => set({ panel: null }),
```

`ui/PanelMenu.tsx` (только для вошедших; бейдж дейлика):

```tsx
import { dailyState } from "../game/daily";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import { uiStore, useUi, type Panel } from "../state/ui-store";
import styles from "./PanelMenu.module.css";

const ITEMS: Array<{ panel: Panel; icon: string; label: string }> = [
  { panel: "shop", icon: "🛒", label: "Магазин" },
  { panel: "daily", icon: "📅", label: "Дейлик" },
];

export function PanelMenu() {
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const panel = useUi((s) => s.panel);
  const now = useServerNow(30_000);
  if (!player || !config) return null;
  const dailyReady = !dailyState(player, config, now).claimedToday;
  return (
    <nav className={styles.menu} aria-label="Разделы">
      {ITEMS.map((item) => (
        <button
          key={item.panel}
          type="button"
          className={panel === item.panel ? styles.on : styles.button}
          aria-pressed={panel === item.panel}
          aria-label={item.panel === "daily" && dailyReady ? `${item.label}: награда ждёт` : item.label}
          onClick={() => uiStore.getState().togglePanel(item.panel)}
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.panel === "daily" && dailyReady && <span className={styles.badge} aria-hidden="true">!</span>}
        </button>
      ))}
    </nav>
  );
}
```

`PanelMenu.module.css`:

```css
.menu {
  display: flex;
  gap: 6px;
}

.button,
.on {
  position: relative;
  min-width: 44px;
  min-height: 44px;
  font-size: 20px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  backdrop-filter: blur(6px);
  cursor: pointer;
}

.on {
  border-color: var(--neon-cyan);
  box-shadow: var(--glow-cyan);
}

.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 12px;
  line-height: 18px;
  font-weight: bold;
  color: #fff;
  background: var(--neon-pink);
  border-radius: 9px;
  box-shadow: var(--glow-pink);
}
```

`ui/SidePanel.tsx` — оболочка, содержимое вкладок подключается в Task 11–12 (пока заглушки-тексты не нужны: рендерить `null` для вкладки, если компонента ещё нет, нельзя — поэтому в этой задаче сразу создать пустые `ShopTab`/`DailyTab`, возвращающие `<p>…</p>`, которые Task 11–12 заменят):

```tsx
import { useEffect } from "react";
import { useGame } from "../state/game-store";
import { uiStore, useUi } from "../state/ui-store";
import { DailyTab } from "./DailyTab";
import { ShopTab } from "./ShopTab";
import styles from "./SidePanel.module.css";

const TITLES = { shop: "Магазин", daily: "Дейлик" } as const;

/** Right-hand drawer (bottom sheet on narrow screens) with one tab at a time; the canvas stays live behind it. */
export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const user = useGame((s) => s.user);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // Logging out closes the panel: everything in it belongs to a player.
  useEffect(() => {
    if (!user) uiStore.getState().closePanel();
  }, [user]);

  if (!panel || !user) return null;
  return (
    <aside className={styles.panel} aria-label={TITLES[panel]}>
      <header className={styles.header}>
        <h2 className={styles.title}>{TITLES[panel]}</h2>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={() => uiStore.getState().closePanel()}>
          ✕
        </button>
      </header>
      <div className={styles.body}>{panel === "shop" ? <ShopTab /> : <DailyTab />}</div>
    </aside>
  );
}
```

Временные `ShopTab.tsx` / `DailyTab.tsx`: `export function ShopTab() { return <p>Магазин</p>; }` и аналогично.

`SidePanel.module.css`:

```css
.panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: min(380px, 100vw);
  padding: calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) 12px;
  background: var(--panel);
  border-left: 1px solid var(--panel-border);
  backdrop-filter: blur(10px);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
}

/* Narrow screens: a bottom sheet, so the canvas stays visible above it. */
@media (max-width: 900px) {
  .panel {
    top: auto;
    left: 0;
    width: auto;
    max-height: 70vh;
    border-left: none;
    border-top: 1px solid var(--panel-border);
    border-radius: var(--radius) var(--radius) 0 0;
    padding-left: calc(12px + env(safe-area-inset-left));
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  margin: 0;
  font-size: 18px;
  color: var(--neon-cyan);
}

.close {
  min-width: 44px;
  min-height: 44px;
  background: none;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  cursor: pointer;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 8px;
}
```

`App.tsx`: в `.topRight` после `<AuthPanel />` — `<PanelMenu />`; после блока `.bottom` (последним ребёнком `.app`) — `<SidePanel />`.

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): add the side panel with shop and daily tabs and a daily badge"
```

---

### Task 11: Вкладка «Магазин»

**Files:** Create `apps/web/src/game/shop.ts`, `shop.test.ts`; Replace `apps/web/src/ui/ShopTab.tsx`; Create `apps/web/src/ui/Tabs.module.css`

- [ ] **Step 1: Тест `shop.test.ts`** — витрина как чистая функция:

```ts
import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { CONFIRM_FROM, shopOffers } from "./shop";

const player = (overrides: Partial<PlayerView> = {}) =>
  ({ coins: 260, chargeCapBonus: 0, unlockedColors: [33], unlimited: false, ...overrides }) as PlayerView;

describe("shopOffers", () => {
  test("items, boost and colors with affordability and confirmation", () => {
    const offers = shopOffers(defaultConfig, player());
    const bomb = offers.find((o) => o.key === "item:bomb")!;
    expect(bomb).toMatchObject({ price: 30, affordable: true, confirm: false, owned: false });
    const defuser = offers.find((o) => o.key === "item:defuser")!;
    expect(defuser).toMatchObject({ price: 150, affordable: true, confirm: true });
    const boost = offers.find((o) => o.key === "boost")!;
    expect(boost).toMatchObject({ price: 500, affordable: false, maxed: false });
    expect(offers.filter((o) => o.kind === "color").map((o) => o.key)).toEqual([32, 33, 34, 35, 36, 37, 38, 39].map((id) => `color:${id}`));
    expect(offers.find((o) => o.key === "color:33")).toMatchObject({ owned: true });
    expect(CONFIRM_FROM).toBe(100);
  });

  test("the boost is maxed at maxTotal", () => {
    const boost = shopOffers(defaultConfig, player({ coins: 9999, chargeCapBonus: 10 })).find((o) => o.key === "boost")!;
    expect(boost.maxed).toBe(true);
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `game/shop.ts`**

```ts
import type { GameConfig, ItemKey, PlayerView } from "@rave/shared/client";

/** Purchases from this price up ask for a second click. */
export const CONFIRM_FROM = 100;

export type Offer =
  | ({ kind: "item"; item: ItemKey } & OfferBase)
  | ({ kind: "boost"; maxed: boolean } & OfferBase)
  | ({ kind: "color"; colorId: number; base: string } & OfferBase);

interface OfferBase {
  key: string;
  title: string;
  price: number;
  affordable: boolean;
  confirm: boolean;
  owned: boolean;
}

const ITEM_TITLES: Record<ItemKey, (amount: number) => string> = {
  bomb: (n) => `💣 Бомба ×${n}`,
  detector: (n) => `🔍 Детектор +${n}`,
  defuser: (n) => `🧯 Дефьюзер +${n}`,
};

/** Everything on sale for this player, in display order. */
export function shopOffers(config: GameConfig, player: Pick<PlayerView, "coins" | "chargeCapBonus" | "unlockedColors">): Offer[] {
  const base = (key: string, title: string, price: number, owned = false): OfferBase => ({
    key,
    title,
    price,
    affordable: player.coins >= price,
    confirm: price >= CONFIRM_FROM,
    owned,
  });
  const items = (["bomb", "detector", "defuser"] as const).map(
    (item): Offer => ({ kind: "item", item, ...base(`item:${item}`, ITEM_TITLES[item](config.shop[item].amount), config.shop[item].price) }),
  );
  const boostCfg = config.shop.chargeCapBoost;
  const boost: Offer = {
    kind: "boost",
    maxed: player.chargeCapBonus + boostCfg.amount > boostCfg.maxTotal,
    ...base("boost", `⚡ Ёмкость зарядов +${boostCfg.amount} (${player.chargeCapBonus}/${boostCfg.maxTotal})`, boostCfg.price),
  };
  const unlocked = new Set(player.unlockedColors);
  const colors = config.palette
    .filter((e) => e.unlock === "shop" && e.price !== undefined)
    .map((e): Offer => ({ kind: "color", colorId: e.id, base: e.base, ...base(`color:${e.id}`, `Цвет ${e.id}`, e.price!, unlocked.has(e.id)) }));
  return [...items, boost, ...colors];
}
```

(`maxed` повторяет проверку движка `chargeCapBonus + amount > maxTotal`.)

`ui/ShopTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { rejectText } from "../game/messages";
import { shopOffers, type Offer } from "../game/shop";
import { shopApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

const ARM_MS = 3_000;

function buy(offer: Offer) {
  if (offer.kind === "item") return shopApi.buyItem(offer.item);
  if (offer.kind === "boost") return shopApi.buyChargeBoost();
  return shopApi.buyColor(offer.colorId);
}

/** Items, the charge boost and colors. New balances arrive over the WebSocket as player updates. */
export function ShopTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!config || !player) return null;
  const offers = shopOffers(config, player);

  const onBuy = async (offer: Offer) => {
    if (busy) return;
    if (offer.confirm && armed !== offer.key) {
      setArmed(offer.key);
      return;
    }
    setArmed(null);
    setBusy(offer.key);
    const answer = await buy(offer);
    setBusy(null);
    const ui = uiStore.getState();
    if (answer.ok) ui.pushToast("info", `Куплено: ${offer.title}`);
    else ui.pushToast("error", rejectText(answer.code));
  };

  const row = (offer: Offer) => {
    const disabled = busy !== null || offer.owned || (offer.kind === "boost" && offer.maxed) || !offer.affordable;
    const label = offer.owned
      ? "Есть"
      : offer.kind === "boost" && offer.maxed
        ? "Максимум"
        : armed === offer.key
          ? `Точно? ${offer.price} 🪙`
          : `${offer.price} 🪙`;
    return (
      <li key={offer.key} className={styles.row}>
        {offer.kind === "color" && <span className={styles.swatch} style={{ background: offer.base }} aria-hidden="true" />}
        <span className={styles.name}>{offer.title}</span>
        <button
          type="button"
          className={armed === offer.key ? styles.armed : styles.buy}
          disabled={disabled}
          aria-label={`${offer.title}: ${label}`}
          onClick={() => void onBuy(offer)}
        >
          {busy === offer.key ? "…" : label}
        </button>
      </li>
    );
  };

  const colors = offers.filter((o) => o.kind === "color");
  return (
    <div className={styles.tab}>
      <p className={styles.balance}>
        Баланс: <strong>{player.coins} 🪙</strong>
      </p>
      <h3 className={styles.section}>Предметы</h3>
      <ul className={styles.list}>{offers.filter((o) => o.kind !== "color").map(row)}</ul>
      {colors.length > 0 && (
        <>
          <h3 className={styles.section}>Цвета</h3>
          <ul className={styles.list}>{colors.map(row)}</ul>
        </>
      )}
    </div>
  );
}
```

`ui/Tabs.module.css` (общий для вкладок):

```css
.tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.balance {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.section {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--neon-pink);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}

.swatch {
  flex: none;
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
}

.name {
  flex: 1;
  min-width: 0;
}

.buy,
.armed {
  flex: none;
  min-width: 96px;
  min-height: 40px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.armed {
  border-color: var(--neon-pink);
  box-shadow: var(--glow-pink);
}

.buy:disabled {
  opacity: 0.45;
  cursor: default;
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): shop tab for items, the charge boost and colors"
```

---

### Task 12: Вкладка «Дейлик»

**Files:** Replace `apps/web/src/ui/DailyTab.tsx`; Modify `apps/web/src/ui/Tabs.module.css`, `apps/web/src/game/daily.ts`, `daily.test.ts`

- [ ] **Step 1: Тест** в `daily.test.ts`:

```ts
import { rewardText } from "./daily";

  test("reward texts", () => {
    expect(rewardText({ item: "coins", amount: 30 })).toBe("30 🪙");
    expect(rewardText({ item: "bomb", amount: 2 })).toBe("💣 ×2");
    expect(rewardText({ item: "detector", amount: 5 })).toBe("🔍 +5");
    expect(rewardText({ item: "defuser", amount: 2 })).toBe("🧯 +2");
  });
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.** `daily.ts`:

```ts
import type { Reward } from "@rave/shared/client";

export function rewardText(r: Reward): string {
  if (r.item === "coins") return `${r.amount} 🪙`;
  if (r.item === "bomb") return `💣 ×${r.amount}`;
  return `${r.item === "detector" ? "🔍" : "🧯"} +${r.amount}`;
}
```

`ui/DailyTab.tsx`:

```tsx
import { useState } from "react";
import { dailyState, rewardText } from "../game/daily";
import { rejectText } from "../game/messages";
import { useServerNow } from "../hooks/useNow";
import { dailyApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

/** Seven-day calendar on a loop: skipping a day does not reset it, one reward per calendar day. */
export function DailyTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState(false);
  if (!config || !player) return null;
  const { claimedToday, step } = dailyState(player, config, now);

  const claim = async () => {
    setBusy(true);
    const answer = await dailyApi.claim();
    setBusy(false);
    const ui = uiStore.getState();
    if (answer.ok) ui.pushToast("info", `📅 Награда: ${rewardText(answer.reward)}`);
    else ui.pushToast("error", rejectText(answer.code));
  };

  return (
    <div className={styles.tab}>
      <ol className={styles.calendar}>
        {config.daily.rewards.map((reward, i) => {
          // The next reward is `step`; once today's is taken, the one before it is today's.
          const today = claimedToday ? (step + config.daily.rewards.length - 1) % config.daily.rewards.length : step;
          const state = i === today ? (claimedToday ? styles.dayTaken : styles.dayNext) : styles.day;
          return (
            <li key={i} className={state} aria-current={i === today ? "date" : undefined}>
              <span className={styles.dayNumber}>День {i + 1}</span>
              <span>{rewardText(reward)}</span>
            </li>
          );
        })}
      </ol>
      <button type="button" className={styles.claim} disabled={claimedToday || busy} onClick={() => void claim()}>
        {claimedToday ? "Сегодня уже получено — приходите завтра" : busy ? "…" : "Забрать награду"}
      </button>
    </div>
  );
}
```

`Tabs.module.css` — добавить:

```css
.calendar {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
}

.day,
.dayNext,
.dayTaken {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}

.dayNext {
  border-color: var(--neon-pink);
  box-shadow: var(--glow-pink);
}

.dayTaken {
  border-color: var(--neon-cyan);
  opacity: 0.7;
}

.dayNumber {
  font-size: 12px;
  opacity: 0.7;
}

.claim {
  min-height: 44px;
  margin-top: 8px;
  background: rgba(255, 43, 214, 0.2);
  border: 1px solid var(--neon-pink);
  border-radius: var(--radius);
  cursor: pointer;
}

.claim:disabled {
  background: none;
  border-color: var(--panel-border);
  opacity: 0.7;
  cursor: default;
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): daily tab with the seven-day calendar"
```

---

### Task 13: Закрытый покупаемый цвет открывает магазин

**Files:** Modify `apps/web/src/ui/PaletteBar.tsx`

- [ ] **Step 1:** В обработчике клика свотча: для закрытого цвета с `entry.unlock === "shop"` — `uiStore.getState().togglePanel("shop")`, если панель ещё не `"shop"` (иначе ничего), без тоста; для прочих закрытых (`daily`, `achievement`) — прежний тост «Этот цвет откроется позже». Для анонимного пользователя (`player === null`) — тост `rejectText("unauthorized")` вместо открытия панели.

```tsx
  const onLocked = (entry: PaletteEntry) => {
    const ui = uiStore.getState();
    if (entry.unlock !== "shop") return ui.pushToast("info", "Этот цвет откроется позже");
    if (!player) return ui.pushToast("error", rejectText("unauthorized"));
    if (ui.panel !== "shop") ui.togglePanel("shop");
  };
```

`aria-label` закрытого покупаемого цвета: `Цвет ${entry.id} (купить за ${entry.price})`.

- [ ] **Step 2:** `bun run typecheck && bun test apps/web && bun run build:web` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/ui/PaletteBar.tsx
git commit -m "feat(web): a locked shop color opens the shop"
```

---

### Task 14: Проверка целиком и roadmap

- [ ] **Step 1:** `bun test`, `bun run typecheck`, `bun run build:web`; размеры чанков (до/после Task 2) — в отчёт.

- [ ] **Step 2: Dev-конфиг.** `bun run config:defaults`, затем перезапуск сервера (`bun --watch` перезапустится при правке файла сервера или вручную).

- [ ] **Step 3: Браузер** (`http://localhost:5173/auth/dev?name=…`):
  1. 🔍 остаётся выбранным после замера; повторный клик по 🔍 — кисть.
  2. 🛒: баланс; покупка бомбы сразу (−30, бомб +1 в HUD); дефьюзер — «Точно? 150 🪙», через 3 с сбрасывается; второй клик покупает. Недостаточно монет — кнопка неактивна. Буст: «Максимум» после 2 покупок (dev-админ или подкрутить монеты).
  3. Цвета 32–39 в магазине и в палитре (с замком); клик по замку открывает магазин; после покупки цвет без замка и выбирается.
  4. 📅: бейдж «!»; «Забрать награду» → тост, бейдж пропадает, день подсвечен как полученный; повтор недоступен.
  5. Лента: взрыв вторым игроком (скрипт из 3c или второй браузерный контекст) → запись «💥 … подорвался на бомбе …» розовая, через 10 с тусклая; перезагрузка — история на месте; «Лента ▸» раскрывает.
  6. Esc и ✕ закрывают панель; выход из аккаунта закрывает панель и прячет меню.
  7. 375×812: панель — шторка снизу, холст виден сверху; лента и палитра не перекрываются.
  8. ErrorBoundary: в DevTools заблокировать `CanvasView-*.js` → «Обновить страницу», остальной UI на месте.
  9. Бандл: нет zod (`grep` из Task 2).

- [ ] **Step 4: Roadmap** — строка 4 разбита на 4a/4b (4a: магазин, дейлик, лента, хвосты 3c; 4b: TanStack Query, рейтинги, профиль), раздел «Заметки для Плана 4» переименовать в «…4b» и вычеркнуть сделанные пункты; добавить новые заметки из финального ревью 4a.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-10-07-00-roadmap.md
git commit -m "docs: update the roadmap after plan 4a"
```

---

## Самопроверка плана

- Спека 2.5 (магазин: предметы, буст, цвета) — Task 6, 9, 11, 13; 2.6 (дейлик: 7 дней по кругу, пропуск не сбрасывает, сутки в часовом поясе конфига) — Task 10 (`dailyState`), 12; 2.9 «живая лента без координат» — Task 7–8 (тест на набор ключей записи истории).
- Решения пользователя: панель с вкладками, тикер+история, бейдж, 8 цветов, подтверждение от 100, липкий детектор с выходом по повторному клику, 4 хвоста 3c — все покрыты.
- Безопасность: история ленты — те же записи, что и живые (без координат). Покупки идут через движок (уже проверено в 2c).
- Зависимости: `ShopTab`/`DailyTab`-заглушки создаются в Task 10, заменяются в 11–12; `togglePanel` (Task 10) используется в Task 13; `shopApi`/`dailyApi` (Task 9) — в 11–12; `@rave/shared/client` (Task 2) — во всех новых клиентских файлах.
