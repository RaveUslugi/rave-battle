# План 3c: инструменты сапёра, миникарта, часы, доводка UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** игрок пользуется детектором и дефьюзером прямо с холста, видит цифры детектора поверх клеток (с возрастом и затуханием), ориентируется по миникарте; клиент перестаёт зависеть от точности системных часов; закрыты хвосты ревью Плана 3b; зум колесом быстрее.

**Architecture:**
- Сервер кладёт `serverNow` в каждый `PlayerView`; клиент хранит смещение часов и сравнивает серверные метки только с «серверным сейчас».
- Детектор и дефьюзер — tRPC-мутации через ванильный `@trpc/client` (`httpBatchLink`). TanStack Query в 3c **не** ставим: у нас только две мутации без кеша; он понадобится в Плане 4 для рейтингов/магазина.
- Замеры детектора — отдельный zustand-стор с `localStorage` (на пользователя, TTL 24 ч, затухание за 1 ч), рисуются слоем `Text` в Pixi.
- Миникарта — новый эндпоинт `GET /overview` (прореженный до ≤256×256 холст, кеш 5 с) + 2D-canvas в углу, клик — перелёт камеры.
- Холст и миникарта грузятся лениво (`React.lazy`) — code splitting.

**Tech Stack:** Bun 1.3.6, TypeScript 7, `@trpc/client` 11.19.0, React 19.3, PixiJS 8.22.0, zustand 5, bun test.

---

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Выбор инструмента | Режимы у палитры: 🔍 детектор, 🧯 дефьюзер рядом с 💣. После использования — возврат в кисть |
| Подтверждение | Детектор: мышь — сразу, касание — через ConfirmBar. Дефьюзер — **всегда** через ConfirmBar |
| Замеры | Полная яркость сразу, к 1 ч — 30 %, через 24 ч удаляются; до 2000 записей на пользователя |
| Миникарта | Правый верхний угол под AuthPanel, сворачивается; на узких экранах (≤ 900 px) свёрнута по умолчанию; состояние в `localStorage` |
| Зум колесом | ~1.5× за щелчок колеса (было ~1.16×), трекпад пропорционально |

Не входит (План 4+): магазин, дейлик, лента, рейтинги, TanStack Query.

```
            ┌──────── PaletteBar ────────┐
            │ 💣 🔍 🧯 │ ■ ■ ■ ■ ■ ■ ■ … │──► ui.tool
            └────────────────────────────┘
 tap/click ─► GameClient.onCellTap ─┬─ tool=paint ──► place() ──► WS PLACE
                                    └─ detector/defuser ─► SapperTools.use()
                                                            │  tRPC POST /trpc/tools.*
                                                            ▼
                                              readingsStore (localStorage)
                                                            │
                                    PixiRenderer.setReadings ◄┘  StatusBar «🔍 2 · 12 мин назад»

 GET /overview (≤256², gzip, кеш 5 с) ──► Minimap ──click──► gameStore.jumpTo ──► CanvasSession
 CanvasSession.applyCamera ──► gameStore.setView ──► Minimap (рамка вьюпорта)
```

## Файлы

Сервер/общие:
- Modify `packages/shared/src/protocol.ts` — `PlayerView.serverNow`, overview-кодек.
- Modify `apps/server/src/net/views.ts`, `views.test.ts`.
- Create `apps/server/src/net/overview.ts`, `overview.test.ts`; Modify `apps/server/src/net/server.ts`, `server.test.ts`.
- Create `packages/shared/src/protocol.overview.test.ts`.

Клиент:
- Modify `apps/web/src/state/game-store.ts` (+test) — смещение часов, `view`, `jump`.
- Modify `apps/web/src/hooks/useNow.ts` — `useServerNow`.
- Modify `apps/web/src/game/pending.ts` (+test), `client.ts` (+test), `messages.ts`, `placement.test.ts`.
- Create `apps/web/src/game/tools.ts` (+test).
- Create `apps/web/src/state/readings-store.ts` (+test).
- Modify `apps/web/src/state/ui-store.ts` (+test) — дедуп тостов, `tool`, экспорт `browserStorage`.
- Create `apps/web/src/net/api.ts`.
- Create `apps/web/src/canvas/reading-view.ts` (+test), `apps/web/src/canvas/minimap-math.ts` (+test).
- Modify `apps/web/src/canvas/viewport.ts` (+test) — `wheelZoomFactor`.
- Modify `apps/web/src/canvas/pixi-renderer.ts`, `session.ts`, `chunk-loader.ts`.
- Modify `apps/web/src/ui/{Hud,FreezeBanner,PaletteBar,ConfirmBar,Toasts,StatusBar}.tsx` и CSS; Create `apps/web/src/ui/Minimap.tsx`, `Minimap.module.css`.
- Modify `apps/web/src/App.tsx`, `App.module.css`, `apps/web/vite.config.ts`, `apps/web/package.json`.
- Modify `docs/superpowers/plans/2026-10-07-00-roadmap.md`.

Команды проверки (из корня репозитория): `bun test`, `bun run typecheck`, `bun run build:web`. Тестам нужен Postgres (`bun run db:up`).

---

### Task 1: `serverNow` в `PlayerView`

**Files:** Modify `packages/shared/src/protocol.ts`, `apps/server/src/net/views.ts`, `apps/server/src/net/views.test.ts`, `apps/web/src/game/placement.test.ts`, `apps/web/src/game/client.test.ts`

- [ ] **Step 1: Тест.** В `views.test.ts`, в первый тест `toPlayerView` добавить:

```ts
    expect(view.serverNow).toBe(T0 + 65_000);
```

- [ ] **Step 2:** `bun test apps/server/src/net/views.test.ts` → FAIL (`undefined`).

- [ ] **Step 3: Реализация.** `protocol.ts`, в `PlayerView` после `unlimited`:

```ts
  /** Server clock when this view was built: lets the client compare server timestamps despite clock skew. */
  serverNow: number;
```

`views.ts`, в возвращаемый объект `toPlayerView` после `unlimited,`:

```ts
    serverNow: now,
```

Веб-фикстуры `player()` в `placement.test.ts` и `client.test.ts`: после `unlimited: false,` добавить `serverNow: NOW,`.

- [ ] **Step 4:** `bun test apps/server/src/net && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts apps/server/src/net/views.ts apps/server/src/net/views.test.ts apps/web/src/game/placement.test.ts apps/web/src/game/client.test.ts
git commit -m "feat(protocol): send the server clock with every player view"
```

---

### Task 2: Смещение часов на клиенте

Баг: `planPlacement`, HUD и баннер заморозки сравнивают `Date.now()` клиента с серверными `chargesUpdatedAt`/`frozenUntil`. Отстающие часы → «Нет зарядов»/«Вы заморожены», хотя сервер бы принял.

**Files:** Modify `apps/web/src/state/game-store.ts`, `game-store.test.ts`, `apps/web/src/hooks/useNow.ts`, `apps/web/src/ui/Hud.tsx`, `apps/web/src/ui/FreezeBanner.tsx`, `apps/web/src/game/client.ts`, `client.test.ts`

- [ ] **Step 1: Тесты.** В `game-store.test.ts` (импорт `createGameStore`, `serverTime` и `type PlayerView`):

```ts
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
```

В `client.test.ts`, в `describe("GameClient")`:

```ts
  test("the pre-check uses server time, so a lagging clock does not block placement", () => {
    // The local clock is 10 s behind: by server time the freeze is over.
    t.game.setState({ player: player({ frozenUntil: NOW + 5_000 }), clockOffset: 10_000 });
    t.client.onCellTap({ x: 1, y: 1 }, "mouse");
    expect(t.sent).toHaveLength(1);
    expect(t.ui.getState().toasts).toHaveLength(0);
  });
```

- [ ] **Step 2:** `bun test apps/web` → FAIL по новым тестам.

- [ ] **Step 3: `game-store.ts`.**

```ts
export interface GameState {
  // …существующие поля…
  /** Server clock minus local clock, from the last player view. */
  clockOffset: number;
  // …
}

/** Server time at local time `now`. Compare server timestamps (freezes, charge timers) with this, never with Date.now(). */
export function serverTime(state: Pick<GameState, "clockOffset">, now = Date.now()): number {
  return now + state.clockOffset;
}

export function createGameStore(clock: () => number = Date.now) {
  const offsetOf = (player: PlayerView | null) => (player ? { clockOffset: player.serverNow - clock() } : {});
  return createStore<GameState>()((set) => ({
    // …
    clockOffset: 0,
    applyHello: (m) => set({ bootId: m.bootId, user: m.user, player: m.player, config: m.config, ...offsetOf(m.player) }),
    setPlayer: (player) => set({ player, ...offsetOf(player) }),
    // …
  }));
}
```

(Смещение занижено на задержку доставки сообщения — клиент чуть консервативнее сервера, это безопасно.)

`hooks/useNow.ts` — добавить:

```ts
import { useGame } from "../state/game-store";

/** Server time, refreshed every `intervalMs`: for countdowns to server timestamps. */
export function useServerNow(intervalMs: number): number {
  const now = useNow(intervalMs);
  const offset = useGame((s) => s.clockOffset);
  return now + offset;
}
```

`Hud.tsx` и `FreezeBanner.tsx`: `useNow(250)` → `useServerNow(250)` (импорт из `../hooks/useNow`).

`client.ts` `place()`: `const now = this.now();` → `const now = this.now() + game.clockOffset;` (используется только для `planPlacement`; таймаут ожидания переводится на монотонные часы в Task 3).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): compare server timestamps with server time, not the local clock"
```

---

### Task 3: Монотонный таймаут и поздние ответы

Две проблемы из ревью 3b: (1) шаг системных часов назад оставляет ожидающий пиксель навсегда; (2) `placed`, пришедший после тоста «Нет ответа», игнорируется — игрок не узнаёт о взрыве.

**Files:** Modify `apps/web/src/game/pending.ts`, `pending.test.ts`, `apps/web/src/game/client.ts`, `client.test.ts`

- [ ] **Step 1: Тесты `pending.test.ts`.** В первом тесте заменить две строки `resolve`:

```ts
    expect(pending.resolve(a.reqId)).toEqual({ item: a, late: false });
    expect(pending.resolve(a.reqId)).toBeUndefined();
```

Добавить:

```ts
  test("expired entries resolve once more as late answers; clear forgets them", () => {
    const pending = new PendingPlacements();
    const old = pending.add({ x: 0, y: 0 }, 1, false, 100);
    pending.expire(10_100, 10_000);
    expect(pending.size).toBe(0);
    expect(pending.resolve(old.reqId)).toEqual({ item: old, late: true });
    expect(pending.resolve(old.reqId)).toBeUndefined();
    const again = pending.add({ x: 0, y: 0 }, 1, false, 100);
    pending.expire(10_100, 10_000);
    pending.clear();
    expect(pending.resolve(again.reqId)).toBeUndefined();
  });

  test("only the most recent 64 expired entries are remembered", () => {
    const pending = new PendingPlacements();
    const items = Array.from({ length: 70 }, (_, i) => pending.add({ x: i, y: 0 }, 1, false, 0));
    pending.expire(10_000, 10_000);
    expect(pending.resolve(items[0]!.reqId)).toBeUndefined();
    expect(pending.resolve(items[69]!.reqId)?.late).toBe(true);
  });
```

`client.test.ts`: в `setup` передать `monotonic: () => now` в конструктор `GameClient`. Добавить тесты:

```ts
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
```

(Если к моменту Task 3 у `CanvasPort` появятся новые методы — в фейке выше их тоже добавить пустыми.)

- [ ] **Step 2:** `bun test apps/web/src/game` → FAIL.

- [ ] **Step 3: `pending.ts`.**

```ts
/** How many expired requests still get their late answer matched. */
const LATE_MEMORY = 64;

export class PendingPlacements {
  private items = new Map<number, Pending>();
  /** Expired entries, oldest first: a late answer may still explain an explosion. */
  private late = new Map<number, Pending>();
  private nextId = 1;

  // add() — без изменений

  resolve(reqId: number): { item: Pending; late: boolean } | undefined {
    const item = this.items.get(reqId);
    if (item) {
      this.items.delete(reqId);
      return { item, late: false };
    }
    const lateItem = this.late.get(reqId);
    if (!lateItem) return undefined;
    this.late.delete(reqId);
    return { item: lateItem, late: true };
  }

  /** Removes and returns entries sent more than `ttlMs` ago; they are remembered for late answers. */
  expire(now: number, ttlMs: number): Pending[] {
    const gone = [...this.items.values()].filter((p) => now - p.at >= ttlMs);
    for (const p of gone) {
      this.items.delete(p.reqId);
      this.late.set(p.reqId, p);
    }
    for (const reqId of this.late.keys()) {
      if (this.late.size <= LATE_MEMORY) break;
      this.late.delete(reqId);
    }
    return gone;
  }

  /** After a disconnect no answer will come, late or not. */
  clear(): void {
    this.items.clear();
    this.late.clear();
  }
  // list(), size, bombs — без изменений
}
```

`client.ts`:

```ts
export interface ClientDeps {
  // …
  /** Monotonic clock for the pending timeout; defaults to performance.now. */
  monotonic?: () => number;
}
// в классе:
  private readonly monotonic: () => number;
// в конструкторе:
    this.monotonic = deps.monotonic ?? (() => performance.now());
```

В `place()`: `this.pending.add(cell, ui.selectedColor, ui.bombMode, now)` → `this.pending.add(cell, ui.selectedColor, ui.bombMode, this.monotonic())`. В `expire()`: `this.pending.expire(this.now(), this.ttlMs)` → `this.pending.expire(this.monotonic(), this.ttlMs)`.

`onPlaced`:

```ts
  readonly onPlaced = (message: PlacedMessage): void => {
    const resolved = this.pending.resolve(message.reqId);
    if (!resolved) return;
    const { item: placed, late } = resolved;
    if (!late) this.port?.setPending(this.pending.list());
    const result = message.result;
    if (!result.ok) {
      // A late reject changes nothing the player can see: the timeout toast already covered it.
      if (!late) this.toast(result.code);
      return;
    }
    if (result.outcome === "placed") return;
    // …дальше без изменений (вспышка, setExplosion, тост)
  };
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/game
git commit -m "fix(web): time out pending pixels on a monotonic clock and explain late explosions"
```

---

### Task 4: Дедупликация тостов и постоянные live-регионы

**Files:** Modify `apps/web/src/state/ui-store.ts`, `ui-store.test.ts`, `apps/web/src/ui/Toasts.tsx`, `Toasts.module.css`

- [ ] **Step 1: Тест** в `ui-store.test.ts`:

```ts
  test("a repeated toast replaces the identical one with a fresh id", () => {
    const store = createUiStore(null);
    const first = store.getState().pushToast("error", "Нет зарядов");
    store.getState().pushToast("info", "x");
    const second = store.getState().pushToast("error", "Нет зарядов");
    expect(second).not.toBe(first);
    expect(store.getState().toasts.map((t) => [t.kind, t.text])).toEqual([["info", "x"], ["error", "Нет зарядов"]]);
  });
```

- [ ] **Step 2:** `bun test apps/web/src/state` → FAIL.

- [ ] **Step 3: Реализация.** `ui-store.ts` `pushToast`:

```ts
    pushToast: (kind, text) => {
      const id = nextId++;
      // Repeated clicks must not stack copies; the new id restarts the dismiss timer.
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.kind !== kind || t.text !== text), { id, kind, text }].slice(-MAX_TOASTS) }));
      return id;
    },
```

`Toasts.tsx`:

```tsx
function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const id = setTimeout(() => uiStore.getState().dismissToast(toast.id), LIFETIME_MS);
    return () => clearTimeout(id);
  }, [toast.id]);
  return <div className={toast.kind === "error" ? styles.error : styles.info}>{toast.text}</div>;
}

/**
 * Short messages that dismiss themselves. The live regions stay mounted: screen readers often skip
 * content of a region that is inserted together with it.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className={styles.stack}>
      <div className={styles.region} role="alert">
        {toasts.filter((t) => t.kind === "error").map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
      <div className={styles.region} role="status">
        {toasts.filter((t) => t.kind === "info").map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </div>
  );
}
```

`Toasts.module.css` — добавить:

```css
.region {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state apps/web/src/ui/Toasts.tsx apps/web/src/ui/Toasts.module.css
git commit -m "fix(web): collapse repeated toasts and keep live regions mounted"
```

---

### Task 5: Мелкие хвосты ревью 3b

1) `title` у статов HUD недостижим (`pointer-events: none`) — убрать; 2) свотчи 32 px — 36 px, на сенсорных экранах 44 px; 3) Home/End в радиогруппе цветов; 4) режим бомбы сам выключается при 0 бомб; 5) клик мышью при открытом выборе касанием сбрасывает выбор.

**Files:** Modify `apps/web/src/ui/Hud.tsx`, `PaletteBar.tsx`, `PaletteBar.module.css`, `apps/web/src/game/client.ts`, `client.test.ts`

- [ ] **Step 1: Тесты** в `client.test.ts`:

```ts
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
```

- [ ] **Step 2:** `bun test apps/web/src/game` → FAIL.

- [ ] **Step 3: Реализация.**

`client.ts` `attach()` — в подписку на `game` добавить:

```ts
        const p = state.player;
        if (p !== prev.player && p && !p.unlimited && p.inventory.bomb === 0 && this.deps.ui.getState().bombMode) {
          this.deps.ui.getState().setBombMode(false);
        }
```

`onCellTap` — перед `this.place(cell)` (ветка не-touch):

```ts
    // A mouse click while a touch selection is open acts on the click, not on the old selection.
    if (this.deps.ui.getState().selection) this.deps.ui.getState().select(null);
```

`Hud.tsx`: удалить атрибуты `title="Монеты"` и `title="Бомбы"` (подписи для скринридеров уже есть в `visually-hidden`).

`PaletteBar.module.css`: у `.swatch` `width: 36px; height: 36px;` и в конец:

```css
/* Touch screens: 44 px targets. */
@media (pointer: coarse) {
  .swatch {
    width: 44px;
    height: 44px;
  }
}
```

`PaletteBar.tsx` `onKeyDown`:

```ts
  // Arrow keys move the checked color over the open ones (locked colors are skipped), Home/End jump to the ends, like native radios.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS[event.key];
    const edge = event.key === "Home" || event.key === "End";
    if (step === undefined && !edge) return;
    event.preventDefault();
    const open = config.palette.filter((e) => !isLocked(e));
    if (open.length === 0) return;
    const at = open.findIndex((e) => e.id === selected);
    const next = event.key === "Home" ? open[0] : event.key === "End" ? open.at(-1) : open[(at + (step ?? 0) + open.length) % open.length];
    if (!next) return;
    uiStore.getState().selectColor(next.id);
    swatchesRef.current?.querySelector<HTMLButtonElement>(`[data-color="${next.id}"]`)?.focus();
  };
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): bigger swatches, Home/End keys, bomb mode off at zero, mouse clears touch selection"
```

---

### Task 6: Раскладка верхней панели на grid вместо фиксированного отступа

Баннер и тосты на узком экране сейчас опущены на фиксированные 128 px — при большом `chargeCap` HUD выше и перекрывается. Делаем общую сетку: на узком экране центральная колонка уходит во второй ряд, который начинается под самым высоким элементом первого.

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/App.module.css`

- [ ] **Step 1: `App.tsx`** — три верхние колонки внутри одного контейнера:

```tsx
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <StatusBar />
          <Hud />
        </div>
        <div className={styles.topCenter}>
          <FreezeBanner />
          <Toasts />
        </div>
        <div className={styles.topRight}>
          <AuthPanel />
        </div>
      </div>
```

- [ ] **Step 2: `App.module.css`** — заменить блоки `.topLeft, .topRight, .topCenter, .bottom {…}`, `.topLeft`, `.topRight`, `.topCenter` и медиазапрос на:

```css
/* Overlay areas let pointer events through to the canvas; only interactive panels take them back. */
.top {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  left: calc(12px + env(safe-area-inset-left));
  right: calc(12px + env(safe-area-inset-right));
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: start;
  pointer-events: none;
}

.topLeft,
.topCenter,
.topRight,
.bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  pointer-events: none;
}

.topLeft {
  align-items: flex-start;
}

.topCenter {
  align-items: center;
  max-width: 94vw;
}

.topRight {
  align-items: flex-end;
}

.topRight > * {
  pointer-events: auto;
}

/* Narrow screens: the banner and toasts get their own row below the taller of HUD and login panel. */
@media (max-width: 900px) {
  .top {
    grid-template-columns: 1fr auto;
  }

  .topCenter {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
```

`position: absolute` у `.bottom` раньше приходил из удалённого общего правила — добавить его в собственное правило `.bottom` (рядом с `left: 0; right: 0; bottom: 0; …`), остальное в нём и правило `.bottom > *` не трогать.

- [ ] **Step 3: Проверка.** `bun run typecheck && bun run build:web`. В браузере (Task 16) — 1280×800 и 375×812: баннер заморозки и тосты не перекрывают HUD, AuthPanel справа.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.module.css
git commit -m "fix(web): lay out the top overlay on a grid instead of a fixed offset"
```

---

### Task 7: Быстрее зум колесом

Сейчас `exp(-deltaY·0.0015)`: щелчок колеса (deltaY ≈ 100) = ×1.16, от «весь холст» до 64× — около 30 щелчков. Делаем ×1.49 за щелчок и ограничиваем один событийный шаг (некоторые мыши шлют deltaY в сотни).

**Files:** Modify `apps/web/src/canvas/viewport.ts`, `viewport.test.ts`, `apps/web/src/canvas/session.ts`

- [ ] **Step 1: Тест** в `viewport.test.ts` (импорт `wheelZoomFactor`):

```ts
describe("wheelZoomFactor", () => {
  test("one mouse notch zooms by about 1.5x either way", () => {
    expect(1 / wheelZoomFactor(100, 0, 800)).toBeCloseTo(Math.exp(0.4), 5);
    expect(wheelZoomFactor(-100, 0, 800)).toBeCloseTo(Math.exp(0.4), 5);
  });

  test("line and page deltas are converted to pixels", () => {
    expect(wheelZoomFactor(3, 1, 800)).toBeCloseTo(Math.exp(-48 * 0.004), 5);
    expect(wheelZoomFactor(1, 2, 50)).toBeCloseTo(Math.exp(-50 * 0.004), 5);
  });

  test("huge deltas are capped", () => {
    expect(wheelZoomFactor(10_000, 0, 800)).toBeCloseTo(Math.exp(-300 * 0.004), 5);
  });
});
```

- [ ] **Step 2:** `bun test apps/web/src/canvas/viewport.test.ts` → FAIL.

- [ ] **Step 3: `viewport.ts`** — добавить:

```ts
const WHEEL_ZOOM_SPEED = 0.004;
const WHEEL_LINE_PX = 16;
const MAX_WHEEL_DELTA_PX = 300;

/**
 * Zoom factor for one wheel event: about 1.5x per mouse notch (deltaY 100), proportionally less for
 * trackpads. `deltaMode`: 0 pixels, 1 lines, 2 pages.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? pageHeight : 1);
  const capped = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, px));
  return Math.exp(-capped * WHEEL_ZOOM_SPEED);
}
```

`session.ts`: удалить константы `WHEEL_ZOOM_SPEED`, `WHEEL_LINE_PX`; в обработчике `wheel` заменить расчёт `lines/pages/deltaY` и фактор на:

```ts
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode, this.renderer.screenSize().h);
        this.camera = zoomAt(this.camera, this.renderer.screenSize(), point.x, point.y, factor, this.zoomLimits(this.canvas));
```

(импорт `wheelZoomFactor` из `./viewport`).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/canvas
git commit -m "feat(web): zoom faster with the mouse wheel"
```

---

### Task 8: tRPC-клиент

**Files:** Modify `apps/web/package.json`, `bun.lock`, `apps/web/src/game/messages.ts`; Create `apps/web/src/net/api.ts`

- [ ] **Step 1: Зависимости** (версии совпадают с сервером; 11.19.0 опубликована 2026-09-16):

```bash
bun add --cwd apps/web --exact @trpc/client@11.19.0
bun add --cwd apps/web --dev --exact @trpc/server@11.19.0
```

`@trpc/server` нужен вебу только для типов `AppRouter` (тип импортируется из `apps/server/src/trpc/router.ts`; проверено: `tsc -p apps/web/tsconfig.json` собирает такой импорт без ошибок).

- [ ] **Step 2: `messages.ts`** — добавить коды и сделать общий текст по умолчанию:

```ts
  no_detector: "Детекторы закончились",
  no_defuser: "Дефьюзеры закончились",
  rate_limited: "Слишком часто, подождите немного",
```

и `return REJECT_TEXT[code] ?? "Действие не удалось";` (если какой-то тест проверяет старый текст по умолчанию — обновить).

- [ ] **Step 3: `net/api.ts`**

```ts
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router";
import type { ToolsApi } from "../game/tools";

const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc" })] });

/** Turns transport and tRPC errors into the same `{ ok: false, code }` shape the engine uses. */
async function call<T>(run: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof TRPCClientError ? (error.data as { code?: string } | undefined)?.code : undefined;
    if (code === "TOO_MANY_REQUESTS") return { ok: false, code: "rate_limited" };
    if (code === "UNAUTHORIZED") return { ok: false, code: "unauthorized" };
    return { ok: false, code: "unavailable" };
  }
}

export const toolsApi: ToolsApi = {
  detect: (cell) => call(() => trpc.tools.detect.mutate(cell)),
  defuse: (cell) => call(() => trpc.tools.defuse.mutate(cell)),
};
```

(`ToolsApi` появится в Task 10; до него файл не компилируется — поэтому коммит этой задачи делается вместе с Task 10, см. там. Шаги 1–2 коммитятся сейчас.)

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` (без `api.ts` — создать его в Task 10, Step 3) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/game/messages.ts
git commit -m "chore(web): add the tRPC client and texts for sapper tool errors"
```

---

### Task 9: Стор замеров детектора

**Files:** Create `apps/web/src/state/readings-store.ts`, `readings-store.test.ts`; Modify `apps/web/src/state/ui-store.ts` (экспорт `browserStorage`)

- [ ] **Step 1: Тест `readings-store.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import {
  createReadingsStore,
  formatAge,
  MAX_READINGS,
  READING_FADE_MS,
  READING_TTL_MS,
  readingAlpha,
  readingAt,
} from "./readings-store";
import type { StorageLike } from "./ui-store";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("readings store", () => {
  test("readings belong to a user, persist and come back", () => {
    const storage = memoryStorage();
    const store = createReadingsStore(storage, () => 1_000);
    store.getState().add({ x: 1, y: 1, count: 2, at: 1_000 }); // no user yet: ignored
    expect(store.getState().readings).toEqual([]);
    store.getState().setUser(7);
    store.getState().add({ x: 1, y: 1, count: 2, at: 1_000 });
    store.getState().add({ x: 1, y: 1, count: 3, at: 1_000 }); // same cell: replaced
    expect(store.getState().readings).toEqual([{ x: 1, y: 1, count: 3, at: 1_000 }]);
    expect(JSON.parse(storage.data["rb:readings:7"]!)).toHaveLength(1);
    store.getState().setUser(8);
    expect(store.getState().readings).toEqual([]);
    store.getState().setUser(7);
    expect(store.getState().readings).toHaveLength(1);
    store.getState().setUser(null);
    expect(store.getState().readings).toEqual([]);
  });

  test("expired and malformed entries are dropped on load and prune", () => {
    let now = READING_TTL_MS + 10;
    const storage = memoryStorage({
      "rb:readings:1": JSON.stringify([
        { x: 0, y: 0, count: 1, at: 5 },
        { x: 1, y: 0, count: 1, at: READING_TTL_MS },
        { x: "bad" },
      ]),
    });
    const store = createReadingsStore(storage, () => now);
    store.getState().setUser(1);
    expect(store.getState().readings.map((r) => r.x)).toEqual([1]);
    now += READING_TTL_MS;
    store.getState().prune();
    expect(store.getState().readings).toEqual([]);
    expect(storage.data["rb:readings:1"]).toBe("[]");
  });

  test("broken storage yields an empty list and adds still work in memory", () => {
    const store = createReadingsStore(memoryStorage({ "rb:readings:1": "{oops" }), () => 0);
    store.getState().setUser(1);
    expect(store.getState().readings).toEqual([]);
    const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const other = createReadingsStore(throwing, () => 0);
    other.getState().setUser(1);
    other.getState().add({ x: 0, y: 0, count: 0, at: 0 });
    expect(other.getState().readings).toHaveLength(1);
  });

  test("keeps the newest MAX_READINGS", () => {
    const store = createReadingsStore(null, () => 0);
    store.getState().setUser(1);
    for (let i = 0; i <= MAX_READINGS; i++) store.getState().add({ x: i, y: 0, count: 0, at: 0 });
    const xs = store.getState().readings.map((r) => r.x);
    expect(xs).toHaveLength(MAX_READINGS);
    expect(xs[0]).toBe(1);
  });
});

describe("reading helpers", () => {
  test("alpha fades from 1 to 0.3 over an hour", () => {
    expect(readingAlpha(0)).toBe(1);
    expect(readingAlpha(READING_FADE_MS / 2)).toBeCloseTo(0.65);
    expect(readingAlpha(READING_FADE_MS * 5)).toBeCloseTo(0.3);
    expect(readingAlpha(-1000)).toBe(1);
  });

  test("ages read naturally", () => {
    expect(formatAge(30_000)).toBe("только что");
    expect(formatAge(12 * 60_000)).toBe("12 мин назад");
    expect(formatAge(3 * 3_600_000 + 5)).toBe("3 ч назад");
  });

  test("readingAt finds the reading of a cell", () => {
    const list = [{ x: 1, y: 2, count: 3, at: 0 }];
    expect(readingAt(list, { x: 1, y: 2 })?.count).toBe(3);
    expect(readingAt(list, { x: 2, y: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2:** `bun test apps/web/src/state/readings-store.test.ts` → FAIL.

- [ ] **Step 3: `readings-store.ts`**

```ts
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { browserStorage, type StorageLike } from "./ui-store";

/** One detector result: `count` bombs in the 3×3 square around (x, y), measured at local time `at`. */
export interface Reading {
  x: number;
  y: number;
  count: number;
  at: number;
}

export const READING_TTL_MS = 24 * 60 * 60 * 1000;
export const READING_FADE_MS = 60 * 60 * 1000;
export const MAX_READINGS = 2000;

export interface ReadingsState {
  userId: number | null;
  /** Oldest first, at most one per cell. */
  readings: Reading[];
  setUser(userId: number | null): void;
  add(reading: Reading): void;
  prune(): void;
}

const keyOf = (userId: number) => `rb:readings:${userId}`;

function isReading(value: unknown): value is Reading {
  const r = value as Reading;
  return (
    typeof r === "object" && r !== null &&
    Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.count) && r.count >= 0 && Number.isFinite(r.at)
  );
}

/** Drops expired readings and keeps the newest MAX_READINGS. */
function fresh(readings: Reading[], now: number): Reading[] {
  return readings.filter((r) => now - r.at < READING_TTL_MS).slice(-MAX_READINGS);
}

/**
 * Detector results live only on this device (spec: no sync, the server never says a reading went stale).
 * Ages use the local clock on both ends, so clock skew does not matter here.
 */
export function createReadingsStore(storage: StorageLike | null, clock: () => number = Date.now) {
  const load = (userId: number): Reading[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(keyOf(userId)) ?? "[]");
      return Array.isArray(parsed) ? fresh(parsed.filter(isReading), clock()) : [];
    } catch {
      return [];
    }
  };
  const save = (userId: number, readings: Reading[]) => {
    try {
      storage?.setItem(keyOf(userId), JSON.stringify(readings));
    } catch {
      // Full or blocked storage: readings stay for this session only.
    }
  };
  return createStore<ReadingsState>()((set, get) => ({
    userId: null,
    readings: [],
    setUser: (userId) => {
      if (userId === get().userId) return;
      set({ userId, readings: userId === null ? [] : load(userId) });
    },
    add: (reading) => {
      const { userId, readings } = get();
      if (userId === null) return;
      const next = fresh([...readings.filter((r) => r.x !== reading.x || r.y !== reading.y), reading], clock());
      set({ readings: next });
      save(userId, next);
    },
    prune: () => {
      const { userId, readings } = get();
      const next = fresh(readings, clock());
      if (next.length === readings.length) return;
      set({ readings: next });
      if (userId !== null) save(userId, next);
    },
  }));
}

/** 1 when fresh, fading linearly to 0.3 at READING_FADE_MS and staying there. */
export function readingAlpha(ageMs: number): number {
  return 1 - 0.7 * Math.min(1, Math.max(0, ageMs) / READING_FADE_MS);
}

export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

export function readingAt(readings: Reading[], cell: { x: number; y: number }): Reading | null {
  return readings.find((r) => r.x === cell.x && r.y === cell.y) ?? null;
}

export const readingsStore = createReadingsStore(browserStorage());

export function useReadings<T>(selector: (state: ReadingsState) => T): T {
  return useStore(readingsStore, selector);
}
```

`ui-store.ts`: `function browserStorage()` → `export function browserStorage()`.

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state
git commit -m "feat(web): store detector readings per user in localStorage"
```

---

### Task 10: Логика инструментов и выбор режима

**Files:** Create `apps/web/src/game/tools.ts`, `tools.test.ts`, `apps/web/src/net/api.ts` (код из Task 8, Step 3); Modify `apps/web/src/state/ui-store.ts`, `ui-store.test.ts`, `apps/web/src/game/client.ts`, `client.test.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Тесты.**

`tools.test.ts`:

```ts
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
    await first;
    expect(t.tools.use("detector", { x: 1, y: 0 })).not.toBeNull();
    expect(t.calls).toHaveLength(2);
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
```

`ui-store.test.ts`:

```ts
  test("switching tools clears the selection", () => {
    const store = createUiStore(null);
    expect(store.getState().tool).toBe("paint");
    store.getState().select({ x: 1, y: 1 });
    store.getState().setTool("detector");
    expect(store.getState()).toMatchObject({ tool: "detector", selection: null });
  });
```

`client.test.ts` — расширить `setup`: опция `detect?: DetectAnswer`; создать `readings = createReadingsStore(null, () => now)`; фейковый API, пишущий вызовы в `toolCalls: string[]`:

```ts
  const toolCalls: string[] = [];
  const tools: ToolsApi = {
    detect: async (c) => (toolCalls.push(`detect ${c.x},${c.y}`), options.detect ?? { ok: true, count: 1 }),
    defuse: async (c) => (toolCalls.push(`defuse ${c.x},${c.y}`), { ok: true, found: false, reward: 0 }),
  };
  const client = new GameClient({ game, ui, readings, tools, now: () => now, monotonic: () => now, timers, pendingTtlMs: 10_000 });
```

вернуть `readings` и `toolCalls` из `setup`, а в фикстуре `player()` поставить `inventory: { bomb: 2, detector: 1, defuser: 1 }`. Тесты:

```ts
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("detector: a click uses it at once and returns to the brush", async () => {
    t.ui.getState().setTool("detector");
    t.client.onCellTap({ x: 5, y: 6 }, "mouse");
    expect(t.toolCalls).toEqual(["detect 5,6"]);
    expect(t.ui.getState().tool).toBe("paint");
    expect(t.sent).toHaveLength(0);
    await tick();
    expect(t.readings.getState().readings).toHaveLength(1);
  });

  test("detector by touch and defuser by any pointer wait for confirmation", () => {
    t.ui.getState().setTool("detector");
    t.client.onCellTap({ x: 1, y: 2 }, "touch");
    expect(t.toolCalls).toEqual([]);
    t.client.confirmSelection();
    expect(t.toolCalls).toEqual(["detect 1,2"]);
    expect(t.ui.getState().selection).toBeNull();

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

  test("readings follow the logged-in user", () => {
    t.game.setState({ user: { id: 2, name: "other" } });
    expect(t.readings.getState().userId).toBe(2);
    t.game.setState({ user: null });
    expect(t.readings.getState().userId).toBeNull();
  });
```

(Тест «a mouse click drops an open touch selection…» из Task 5 остаётся: инструмент там — кисть.)

- [ ] **Step 2:** `bun test apps/web` → FAIL.

- [ ] **Step 3: Реализация.**

`ui-store.ts`:

```ts
import type { Tool } from "../game/tools";

export type ActiveTool = "paint" | Tool;

export interface UiState {
  // …
  /** What a tap does. Bomb mode only applies to "paint". */
  tool: ActiveTool;
  setTool(tool: ActiveTool): void;
}
// в createUiStore:
    tool: "paint",
    // The pending selection meant something else under the previous tool.
    setTool: (tool) => set({ tool, selection: null }),
```

`game/tools.ts`:

```ts
import type { StoreApi } from "zustand/vanilla";
import { serverTime, type GameState } from "../state/game-store";
import type { ReadingsState } from "../state/readings-store";
import type { UiState } from "../state/ui-store";
import { isFrozen } from "./charges";
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
  if (!answer.found) return "Бомбы не было — дефьюзер потрачен";
  return answer.reward > 0 ? `🧯 Бомба обезврежена! +${answer.reward} монет` : "🧯 Снята ваша собственная бомба";
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
    if (this.busy) return null;
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
    if (isFrozen(player, serverTime(game, this.now()))) return "frozen";
    if (!player.unlimited && player.inventory[tool] < 1) return tool === "detector" ? "no_detector" : "no_defuser";
    return null;
  }

  private async run(tool: Tool, cell: Cell): Promise<void> {
    try {
      if (tool === "detector") {
        const answer = await this.deps.api.detect(cell);
        if (!answer.ok) return this.toast(answer.code);
        this.deps.readings.getState().add({ x: cell.x, y: cell.y, count: answer.count, at: this.now() });
        this.deps.ui.getState().pushToast("info", `🔍 Бомб рядом: ${answer.count}`);
      } else {
        const answer = await this.deps.api.defuse(cell);
        if (!answer.ok) return this.toast(answer.code);
        this.deps.ui.getState().pushToast("info", defuseText(answer));
      }
    } catch {
      this.toast("unavailable");
    }
  }

  private toast(code: string): void {
    this.deps.ui.getState().pushToast("error", rejectText(code));
  }
}
```

Инвентарь обновится сам: сервер шлёт `player` по WebSocket после коммита.

`client.ts`:

```ts
import type { ReadingsState } from "../state/readings-store";
import { SapperTools, type Tool, type ToolsApi } from "./tools";

export interface ClientDeps {
  // …
  /** Both are needed for the sapper tools; without them tool taps say the server is unavailable. */
  readings?: StoreApi<ReadingsState>;
  tools?: ToolsApi;
}
// поле:
  private readonly sapper: SapperTools | null;
// в конструкторе:
    this.sapper = deps.tools && deps.readings
      ? new SapperTools({ game: deps.game, ui: deps.ui, readings: deps.readings, api: deps.tools, now: this.now })
      : null;
```

`attach()`: перед `this.unsubscribe = [...]` — `this.deps.readings?.getState().setUser(this.deps.game.getState().user?.id ?? null);`; в подписку на `game` добавить:

```ts
        if (state.user?.id !== prev.user?.id) this.deps.readings?.getState().setUser(state.user?.id ?? null);
```

`onCellTap` и `confirmSelection`:

```ts
  readonly onCellTap = (cell: Cell, pointerType: string): void => {
    const ui = this.deps.ui.getState();
    if (!this.deps.game.getState().user) {
      this.toast("unauthorized");
      return;
    }
    // Touch always confirms; the defuser is expensive, so it confirms for every pointer.
    if (pointerType === "touch" || ui.tool === "defuser") {
      ui.select(cell);
      return;
    }
    // A mouse click while a touch selection is open acts on the click, not on the old selection.
    if (ui.selection) ui.select(null);
    if (ui.tool === "paint") this.place(cell);
    else this.useTool(ui.tool, cell);
  };

  readonly confirmSelection = (): void => {
    const ui = this.deps.ui.getState();
    const selection = ui.selection;
    if (!selection) return;
    const done = ui.tool === "paint" ? this.place(selection) : this.useTool(ui.tool, selection);
    if (done) this.deps.ui.getState().select(null);
  };

  /** True when the request was sent; the brush comes back so the next tap paints again. */
  private useTool(tool: Tool, cell: Cell): boolean {
    if (!this.sapper) {
      this.toast("unavailable");
      return false;
    }
    if (!this.sapper.use(tool, cell)) return false;
    this.deps.ui.getState().setTool("paint");
    return true;
  }
```

(`setTool` уже сбрасывает выбор; повторный `select(null)` в `confirmSelection` безвреден.)

`net/api.ts` — создать с кодом из Task 8, Step 3.

`App.tsx`:

```tsx
import { toolsApi } from "./net/api";
import { readingsStore } from "./state/readings-store";
// …
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore, readings: readingsStore, tools: toolsApi }), []);
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): use the detector and defuser from the canvas"
```

---

### Task 11: Кнопки инструментов и ConfirmBar

**Files:** Modify `apps/web/src/ui/PaletteBar.tsx`, `PaletteBar.module.css`, `apps/web/src/ui/ConfirmBar.tsx`

- [ ] **Step 1: `PaletteBar.tsx`.** Вместо одной кнопки бомбы — группа из трёх; бомба включает режим кисти:

```tsx
  const tool = useUi((s) => s.tool);
  const count = (item: "bomb" | "detector" | "defuser") => (player?.unlimited ? "∞" : (player?.inventory[item] ?? 0));
  const bombs = count("bomb");
  const pickTool = (next: "detector" | "defuser") => uiStore.getState().setTool(tool === next ? "paint" : next);
```

```tsx
      <div className={styles.tools} role="group" aria-label="Инструменты">
        <button
          type="button"
          className={tool === "paint" && bombMode ? styles.toolOn : styles.tool}
          aria-pressed={tool === "paint" && bombMode}
          aria-label={`Режим бомбы, осталось ${bombs}`}
          onClick={() => {
            const ui = uiStore.getState();
            const on = !(tool === "paint" && bombMode);
            ui.setTool("paint");
            ui.setBombMode(on);
          }}
        >
          <span aria-hidden="true">💣</span>
          <span aria-hidden="true">{bombs}</span>
        </button>
        <button
          type="button"
          className={tool === "detector" ? styles.toolOn : styles.tool}
          aria-pressed={tool === "detector"}
          aria-label={`Детектор, осталось ${count("detector")}`}
          onClick={() => pickTool("detector")}
        >
          <span aria-hidden="true">🔍</span>
          <span aria-hidden="true">{count("detector")}</span>
        </button>
        <button
          type="button"
          className={tool === "defuser" ? styles.toolOn : styles.tool}
          aria-pressed={tool === "defuser"}
          aria-label={`Дефьюзер, осталось ${count("defuser")}`}
          onClick={() => pickTool("defuser")}
        >
          <span aria-hidden="true">🧯</span>
          <span aria-hidden="true">{count("defuser")}</span>
        </button>
      </div>
```

Старую переменную `bombs` (строка `const bombs = player?.unlimited ? …`) заменить на `count("bomb")` как выше.

- [ ] **Step 2: `PaletteBar.module.css`.** Переименовать `.bomb, .bombOn` → `.tool, .toolOn` (тот же стиль; `.bombOn` → `.toolOn`) и добавить:

```css
.tools {
  flex: none;
  display: flex;
  gap: 6px;
}

/* Phones: three tool buttons plus swatches need the room. */
@media (max-width: 480px) {
  .tool,
  .toolOn {
    min-width: 48px;
    padding: 0 8px;
  }
}
```

- [ ] **Step 3: `ConfirmBar.tsx`.**

```tsx
import { useGame } from "../state/game-store";
// …
const ACTION = { paint: "Поставить", detector: "Сканировать", defuser: "Обезвредить" } as const;

export function ConfirmBar({ client }: { client: GameClient }) {
  const selection = useUi((s) => s.selection);
  const bombMode = useUi((s) => s.bombMode);
  const tool = useUi((s) => s.tool);
  const player = useGame((s) => s.player);
  if (!selection) return null;
  const left = player?.unlimited ? "∞" : (player?.inventory.defuser ?? 0);
  return (
    <div className={styles.bar} role="group" aria-label="Подтверждение клетки">
      <span className={styles.cell}>
        {selection.x}, {selection.y}
        {tool === "paint" && bombMode && (
          <>
            <span aria-hidden="true"> · 💣</span>
            <span className="visually-hidden">, с бомбой</span>
          </>
        )}
        {tool === "detector" && <span> · 🔍</span>}
        {tool === "defuser" && <span> · 🧯 осталось {left}</span>}
      </span>
      <button type="button" className={styles.cancel} onClick={client.cancelSelection}>
        Отмена
      </button>
      <button type="button" className={styles.confirm} onClick={client.confirmSelection}>
        {ACTION[tool]}
      </button>
    </div>
  );
}
```

- [ ] **Step 4:** `bun run typecheck && bun test apps/web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): tool buttons next to the palette and tool-aware confirmation"
```

---

### Task 12: Цифры детектора на холсте и в строке статуса

**Files:** Create `apps/web/src/canvas/reading-view.ts`, `reading-view.test.ts`; Modify `apps/web/src/canvas/pixi-renderer.ts`, `apps/web/src/canvas/session.ts`, `apps/web/src/ui/StatusBar.tsx`

- [ ] **Step 1: Тест `reading-view.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { READING_MIN_ZOOM, readingColor, visibleReadings } from "./reading-view";

const r = (x: number, y: number) => ({ x, y, count: 1, at: 0 });

describe("visibleReadings", () => {
  test("nothing below the minimum zoom", () => {
    expect(visibleReadings([r(10, 10)], { x: 10, y: 10, zoom: READING_MIN_ZOOM - 1 }, { w: 100, h: 100 })).toEqual([]);
  });

  test("keeps readings on screen, newest first, up to the cap", () => {
    const cam = { x: 10, y: 10, zoom: 10 }; // 100x100 screen shows cells 5..15
    const list = [r(5, 5), r(14, 14), r(30, 30), r(10, 10)];
    expect(visibleReadings(list, cam, { w: 100, h: 100 })).toEqual([r(10, 10), r(14, 14), r(5, 5)]);
    expect(visibleReadings(list, cam, { w: 100, h: 100 }, 1)).toEqual([r(10, 10)]);
  });

  test("colors saturate at four", () => {
    expect(readingColor(9)).toBe(readingColor(4));
    expect(readingColor(0)).not.toBe(readingColor(1));
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `reading-view.ts`**

```ts
import type { Reading } from "../state/readings-store";
import type { Camera, ScreenSize } from "./viewport";

/** Below this zoom a cell is too small for a digit. */
export const READING_MIN_ZOOM = 6;
export const MAX_DRAWN_READINGS = 400;

/** Minesweeper-like: grey 0, cyan 1, green 2, yellow 3, pink 4+. */
const COLORS = [0x9aa0b4, 0x22f3ff, 0x39ff88, 0xffe14d, 0xff2bd6];

export function readingColor(count: number): number {
  return COLORS[Math.min(count, COLORS.length - 1)]!;
}

/** Readings whose cell is on screen, newest first, at most `max`. */
export function visibleReadings(readings: Reading[], cam: Camera, size: ScreenSize, max = MAX_DRAWN_READINGS): Reading[] {
  if (cam.zoom < READING_MIN_ZOOM) return [];
  const halfW = size.w / 2 / cam.zoom;
  const halfH = size.h / 2 / cam.zoom;
  const left = cam.x - halfW - 1;
  const right = cam.x + halfW;
  const top = cam.y - halfH - 1;
  const bottom = cam.y + halfH;
  const out: Reading[] = [];
  for (let i = readings.length - 1; i >= 0 && out.length < max; i--) {
    const r = readings[i]!;
    if (r.x >= left && r.x <= right && r.y >= top && r.y <= bottom) out.push(r);
  }
  return out;
}
```

- [ ] **Step 4: `pixi-renderer.ts`.** Импорты: `Text, TextStyle` из `pixi.js`; `readingAlpha, type Reading` из `../state/readings-store`; `readingColor, visibleReadings` из `./reading-view`. Константы:

```ts
const READING_FONT_SIZE = 48;
const READING_STYLE = new TextStyle({
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: READING_FONT_SIZE,
  fontWeight: "bold",
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 8 },
});
```

Поля:

```ts
  /** Detector digits (screen space); Text objects are pooled and only re-laid out. */
  private readonly readingsLayer = new Container();
  private readingTexts: Text[] = [];
  private readings: Reading[] = [];
```

В `init`: `this.app.stage.addChild(this.world, this.grid, this.readingsLayer, this.overlay, this.fx);`. В конец `setCamera`: `this.drawReadings();`. Методы:

```ts
  /** Detector readings to show; call again to refresh their fading. Stored before init too. */
  setReadings(readings: Reading[]): void {
    this.readings = readings;
    this.drawReadings();
  }

  /** One white Text per visible reading, tinted by count and scaled to the cell (fixed font size, no re-rasterising on zoom). */
  private drawReadings(): void {
    if (this.state !== "ready") return;
    const { width, height } = this.app.screen;
    const visible = visibleReadings(this.readings, this.camera, { w: width, h: height });
    while (this.readingTexts.length < visible.length) {
      const text = new Text({ text: "", style: READING_STYLE, anchor: 0.5 });
      this.readingsLayer.addChild(text);
      this.readingTexts.push(text);
    }
    const zoom = this.camera.zoom;
    const origin = this.origin();
    const scale = (zoom * 0.8) / READING_FONT_SIZE;
    const now = Date.now();
    this.readingTexts.forEach((text, i) => {
      const reading = visible[i];
      text.visible = reading !== undefined;
      if (!reading) return;
      text.text = String(reading.count);
      text.tint = readingColor(reading.count);
      text.alpha = readingAlpha(now - reading.at);
      text.scale.set(scale);
      text.position.set(origin.x + (reading.x + 0.5) * zoom, origin.y + (reading.y + 0.5) * zoom);
    });
  }
```

(Тексты — дети `stage`, их уничтожит существующий `app.destroy(…, { children: true, … })`.)

- [ ] **Step 5: `session.ts`.** Импорт `readingsStore`. Поля `private unsubscribeReadings: (() => void) | null = null; private fadeTimer: ReturnType<typeof setInterval> | null = null;`. В `start()` после создания контроллера:

```ts
    this.renderer.setReadings(readingsStore.getState().readings);
    this.unsubscribeReadings = readingsStore.subscribe((state, prev) => {
      if (state.readings !== prev.readings) this.renderer.setReadings(state.readings);
    });
    // Fading depends on age: redraw now and then, and drop expired readings.
    this.fadeTimer = setInterval(() => {
      readingsStore.getState().prune();
      this.renderer.setReadings(readingsStore.getState().readings);
    }, 30_000);
```

В `dispose()`: `this.unsubscribeReadings?.(); if (this.fadeTimer) clearInterval(this.fadeTimer);`.

- [ ] **Step 6: `StatusBar.tsx`** — возраст замера под курсором:

```tsx
import { useNow } from "../hooks/useNow";
import { formatAge, readingAt, useReadings } from "../state/readings-store";
// …
  const readings = useReadings((s) => s.readings);
  const now = useNow(30_000);
  const reading = hover ? readingAt(readings, hover) : null;
// …
      {hover && (
        <span className={styles.coords} aria-hidden="true">
          {hover.x}, {hover.y}
          {reading && ` · 🔍 ${reading.count} · ${formatAge(now - reading.at)}`}
        </span>
      )}
```

- [ ] **Step 7:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): draw detector readings on the canvas and show their age"
```

---

### Task 13: `GET /overview` для миникарты

**Files:** Modify `packages/shared/src/protocol.ts`; Create `packages/shared/src/protocol.overview.test.ts`, `apps/server/src/net/overview.ts`, `apps/server/src/net/overview.test.ts`; Modify `apps/server/src/net/server.ts`, `server.test.ts`, `apps/web/vite.config.ts`

- [ ] **Step 1: Тесты.**

`protocol.overview.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { decodeOverview, encodeOverview, overviewShape } from "./protocol";

describe("overview", () => {
  test("shape keeps the longest side at most 256", () => {
    expect(overviewShape(512, 512)).toEqual({ step: 2, width: 256, height: 256 });
    expect(overviewShape(256, 512)).toEqual({ step: 2, width: 128, height: 256 });
    expect(overviewShape(256, 256)).toEqual({ step: 1, width: 256, height: 256 });
    expect(overviewShape(16384, 256)).toEqual({ step: 64, width: 256, height: 4 });
  });

  test("round-trips and rejects wrong sizes", () => {
    const colors = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const bytes = encodeOverview({ step: 2, width: 3, height: 2, colors });
    expect(decodeOverview(bytes)).toEqual({ step: 2, width: 3, height: 2, colors });
    expect(decodeOverview(bytes.slice(0, -1))).toBeNull();
  });
});
```

`apps/server/src/net/overview.test.ts`:

```ts
import { decodeOverview } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { CanvasStore } from "../engine/canvas-store";
import { buildOverview, OverviewCache } from "./overview";

describe("overview", () => {
  test("samples the top-left cell of each block", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(2, 2, 5, 1);
    canvas.set(3, 3, 9, 1); // inside the same 2x2 block: not sampled
    const o = decodeOverview(buildOverview(canvas))!;
    expect(o.step).toBe(2);
    expect(o.colors[1 * 256 + 1]).toBe(5);
    expect(o.colors[0]).toBe(0);
  });

  test("the cache rebuilds only after maxAge", () => {
    let now = 0;
    const canvas = new CanvasStore(256, 256);
    const cache = new OverviewCache(5_000, () => now);
    const first = cache.get(canvas);
    canvas.set(0, 0, 7, 1);
    expect(cache.get(canvas)).toBe(first);
    now = 5_000;
    const fresh = decodeOverview(Bun.gunzipSync(cache.get(canvas)))!;
    expect(fresh.colors[0]).toBe(7);
  });
});
```

`server.test.ts`, в `describe("http")`:

```ts
  test("overview returns the sampled canvas", async () => {
    const alice = await connect(await login("alice"));
    alice.ws.send(encodePlace({ reqId: 1, x: 2, y: 2, colorId: 5, withBomb: false }));
    await placed(alice, 1);
    const o = decodeOverview(new Uint8Array(await (await fetch(`${base}/overview`)).arrayBuffer()))!;
    expect(o).toMatchObject({ step: 2, width: 256, height: 256 });
    expect(o.colors[1 * 256 + 1]).toBe(5);
  });
```

(импорт `decodeOverview` из `@rave/shared`; кеш создаётся заново в каждом `startServer`, поэтому первый запрос всегда свежий.)

- [ ] **Step 2:** `bun test packages apps/server/src/net` → FAIL.

- [ ] **Step 3: `protocol.ts`** — рядом с `encodeChunkBody`:

```ts
// ---- GET /overview: the whole canvas sampled down for the minimap ----

export const OVERVIEW_MAX_SIDE = 256;

export interface Overview {
  /** Canvas cells per overview cell (the top-left cell of each block is sampled). */
  step: number;
  width: number;
  height: number;
  colors: Uint8Array;
}

export function overviewShape(canvasWidth: number, canvasHeight: number): Omit<Overview, "colors"> {
  const step = Math.max(1, Math.ceil(Math.max(canvasWidth, canvasHeight) / OVERVIEW_MAX_SIDE));
  return { step, width: Math.ceil(canvasWidth / step), height: Math.ceil(canvasHeight / step) };
}

/** u16 LE step, width, height, then width×height color ids. */
export function encodeOverview(o: Overview): Uint8Array {
  const bytes = new Uint8Array(6 + o.colors.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, o.step, true);
  view.setUint16(2, o.width, true);
  view.setUint16(4, o.height, true);
  bytes.set(o.colors, 6);
  return bytes;
}

export function decodeOverview(bytes: Uint8Array): Overview | null {
  if (bytes.byteLength < 6) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const step = view.getUint16(0, true);
  const width = view.getUint16(2, true);
  const height = view.getUint16(4, true);
  if (bytes.byteLength !== 6 + width * height) return null;
  return { step, width, height, colors: bytes.slice(6) };
}
```

`apps/server/src/net/overview.ts`:

```ts
import { encodeOverview, overviewShape } from "@rave/shared";
import type { CanvasStore } from "../engine/canvas-store";

export function buildOverview(canvas: CanvasStore): Uint8Array {
  const { step, width, height } = overviewShape(canvas.width, canvas.height);
  const colors = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) colors[j * width + i] = canvas.get(i * step, j * step).colorId;
  }
  return encodeOverview({ step, width, height, colors });
}

/** Gzipped overview, rebuilt at most once per `maxAgeMs`: the minimap is a rough picture, not a live view. */
export class OverviewCache {
  private body: Uint8Array<ArrayBuffer> | null = null;
  private builtAt = 0;

  constructor(
    private readonly maxAgeMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(canvas: CanvasStore): Uint8Array<ArrayBuffer> {
    const now = this.now();
    if (!this.body || now - this.builtAt >= this.maxAgeMs) {
      this.body = Bun.gzipSync(buildOverview(canvas) as Uint8Array<ArrayBuffer>);
      this.builtAt = now;
    }
    return this.body;
  }
}
```

`server.ts`: в `startServer` — `const overview = new OverviewCache();` и передать в `route(req, srv, deps, limiter, ipLimiter, overview)`; в сигнатуру `route` добавить `overview: OverviewCache`; маршрут после `chunk`:

```ts
  if (req.method === "GET" && url.pathname === "/overview") return overviewResponse(deps, overview);
```

и функция рядом с `chunkResponse`:

```ts
function overviewResponse(deps: AppDeps, cache: OverviewCache): Response {
  return new Response(cache.get(deps.runtime.engine.canvas), {
    headers: { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip", "Cache-Control": "no-store" },
  });
}
```

`apps/web/vite.config.ts` — в `proxy` добавить `"/overview": SERVER,`.

- [ ] **Step 4:** `bun test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src apps/server/src/net apps/web/vite.config.ts
git commit -m "feat(server): serve a sampled overview of the canvas for the minimap"
```

---

### Task 14: Миникарта

**Files:** Create `apps/web/src/canvas/minimap-math.ts`, `minimap-math.test.ts`, `apps/web/src/ui/Minimap.tsx`, `Minimap.module.css`; Modify `apps/web/src/state/game-store.ts`, `game-store.test.ts`, `apps/web/src/canvas/session.ts`, `apps/web/src/canvas/chunk-loader.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Тесты.**

`minimap-math.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { minimapLayout, minimapToCanvas, viewportRect } from "./minimap-math";

describe("minimap math", () => {
  test("layout fits the longest side into the box", () => {
    expect(minimapLayout({ width: 512, height: 256 }, 160)).toEqual({ width: 160, height: 80, scale: 160 / 512 });
  });

  test("map points become clamped canvas cells", () => {
    const layout = minimapLayout({ width: 512, height: 512 }, 128); // 4 cells per map px
    expect(minimapToCanvas(layout, 10, 20, { width: 512, height: 512 })).toEqual({ x: 40, y: 80 });
    expect(minimapToCanvas(layout, -5, 999, { width: 512, height: 512 })).toEqual({ x: 0, y: 511 });
  });

  test("the viewport rectangle follows camera and screen", () => {
    const layout = minimapLayout({ width: 512, height: 512 }, 128);
    const rect = viewportRect({ camera: { x: 256, y: 256, zoom: 2 }, screen: { w: 400, h: 200 } }, layout);
    expect(rect).toEqual({ x: (256 - 100) / 4, y: (256 - 50) / 4, w: 50, h: 25 });
  });
});
```

`game-store.test.ts`:

```ts
test("view and jump requests are stored", () => {
  const store = createGameStore(() => 0);
  store.getState().setView({ camera: { x: 1, y: 2, zoom: 3 }, screen: { w: 4, h: 5 } });
  expect(store.getState().view).toEqual({ camera: { x: 1, y: 2, zoom: 3 }, screen: { w: 4, h: 5 } });
  store.getState().jumpTo(10, 20);
  const first = store.getState().jump;
  store.getState().jumpTo(10, 20);
  expect(store.getState().jump).toEqual({ x: 10, y: 20 });
  expect(store.getState().jump).not.toBe(first); // same target twice still triggers
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `minimap-math.ts`**

```ts
import type { Camera, CanvasSize, ScreenSize } from "./viewport";

/** CSS size of the map and CSS pixels per canvas cell. */
export interface MinimapLayout {
  width: number;
  height: number;
  scale: number;
}

export function minimapLayout(canvas: CanvasSize, box: number): MinimapLayout {
  const scale = box / Math.max(canvas.width, canvas.height);
  return { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale), scale };
}

export function minimapToCanvas(layout: MinimapLayout, px: number, py: number, canvas: CanvasSize): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v)));
  return { x: clamp(px / layout.scale, canvas.width), y: clamp(py / layout.scale, canvas.height) };
}

export function viewportRect(view: { camera: Camera; screen: ScreenSize }, layout: MinimapLayout) {
  const halfW = view.screen.w / 2 / view.camera.zoom;
  const halfH = view.screen.h / 2 / view.camera.zoom;
  return {
    x: (view.camera.x - halfW) * layout.scale,
    y: (view.camera.y - halfH) * layout.scale,
    w: 2 * halfW * layout.scale,
    h: 2 * halfH * layout.scale,
  };
}
```

`game-store.ts`:

```ts
import type { Camera, ScreenSize } from "../canvas/viewport";
// в GameState:
  /** Current camera and screen size, published by the canvas session for the minimap. */
  view: { camera: Camera; screen: ScreenSize } | null;
  /** Latest "center the camera here" request; a new object every time. */
  jump: { x: number; y: number } | null;
  setView(view: { camera: Camera; screen: ScreenSize }): void;
  jumpTo(x: number, y: number): void;
// в createGameStore:
    view: null,
    jump: null,
    setView: (view) => set({ view }),
    jumpTo: (x, y) => set({ jump: { x, y } }),
```

`chunk-loader.ts`:

```ts
import { decodeChunkBody, decodeOverview, type Overview } from "@rave/shared";
// …
/** GET /overview: the whole canvas sampled down to at most 256×256. */
export async function fetchOverview(signal?: AbortSignal): Promise<Overview> {
  const res = await fetch("/overview", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`overview: HTTP ${res.status}`);
  const body = decodeOverview(new Uint8Array(await res.arrayBuffer()));
  if (!body) throw new Error("overview: malformed body");
  return body;
}
```

`session.ts`:
- В `applyCamera` сразу после `this.renderer.setCamera(this.camera);` — `gameStore.getState().setView({ camera: this.camera, screen: size });`.
- Поле `private unsubscribeJump: (() => void) | null = null;`; в `start()` после создания контроллера:

```ts
    this.unsubscribeJump = gameStore.subscribe((state, prev) => {
      if (!state.jump || state.jump === prev.jump || !this.camera) return;
      this.camera = { ...this.camera, x: state.jump.x + 0.5, y: state.jump.y + 0.5 };
      this.applyCamera();
    });
```

- В `dispose()` — `this.unsubscribeJump?.();`.

`ui/Minimap.tsx` (default export — для `React.lazy`):

```tsx
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fetchOverview } from "../canvas/chunk-loader";
import { minimapLayout, minimapToCanvas, viewportRect } from "../canvas/minimap-math";
import { buildPaletteLut, paintRgba } from "../canvas/palette";
import { gameStore, useGame } from "../state/game-store";
import styles from "./Minimap.module.css";

const BOX = 160;
const REFRESH_MS = 15_000;
const OPEN_KEY = "rb:minimap";

function initiallyOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Blocked storage: fall through to the screen-size default.
  }
  return !window.matchMedia("(max-width: 900px)").matches;
}

/** Whole-canvas overview with the current viewport; click or drag to move the camera there. */
export default function Minimap() {
  const config = useGame((s) => s.config);
  const view = useGame((s) => s.view);
  const [open, setOpen] = useState(initiallyOpen);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => (config ? minimapLayout(config.canvas, BOX) : null), [config]);

  // Fetch while open and the tab is visible; the server caches the overview for a few seconds anyway.
  useEffect(() => {
    if (!open || !config) return;
    const abort = new AbortController();
    const lut = buildPaletteLut(config.palette);
    const load = () => {
      if (document.hidden) return;
      fetchOverview(abort.signal)
        .then((o) => {
          const img = document.createElement("canvas");
          img.width = o.width;
          img.height = o.height;
          const ctx = img.getContext("2d");
          if (!ctx) return;
          const data = ctx.createImageData(o.width, o.height);
          paintRgba(o.colors, lut, new Uint8Array(data.data.buffer));
          ctx.putImageData(data, 0, 0);
          setImage(img);
        })
        .catch(() => {
          // Offline or aborted: keep the last picture.
        });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      abort.abort();
      clearInterval(id);
    };
  }, [open, config]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(layout.width * dpr);
    el.height = Math.round(layout.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (image) ctx.drawImage(image, 0, 0, layout.width, layout.height);
    if (view) {
      const r = viewportRect(view, layout);
      ctx.strokeStyle = "#22f3ff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }, [layout, view, image, open]);

  if (!config || !layout) return null;

  const toggle = () =>
    setOpen((was) => {
      try {
        window.localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        // Not remembered; fine.
      }
      return !was;
    });

  const jump = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cell = minimapToCanvas(layout, event.clientX - rect.left, event.clientY - rect.top, config.canvas);
    gameStore.getState().jumpTo(cell.x, cell.y);
  };

  return (
    <div className={styles.minimap}>
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">🗺 </span>Карта
      </button>
      {open && (
        <canvas
          ref={mapRef}
          className={styles.map}
          style={{ width: layout.width, height: layout.height }}
          role="img"
          aria-label="Миникарта холста"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            jump(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) jump(e);
          }}
        />
      )}
    </div>
  );
}
```

`ui/Minimap.module.css`:

```css
.minimap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.toggle {
  min-height: 36px;
  padding: 0 12px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  backdrop-filter: blur(6px);
  cursor: pointer;
}

.map {
  display: block;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  box-shadow: var(--glow-cyan);
  touch-action: none;
  cursor: crosshair;
}
```

`App.tsx` (lazy подключение — в Task 15; пока обычный импорт): в `.topRight` после `<AuthPanel />` — `<Minimap />` (`import Minimap from "./ui/Minimap";`).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): add a collapsible minimap that moves the camera"
```

---

### Task 15: Code splitting

Сейчас один чанк ~590 КБ, из них основная часть — PixiJS. Холст и миникарта грузятся лениво, интерфейс вокруг появляется раньше.

**Files:** Modify `apps/web/src/App.tsx`, возможно `apps/web/vite.config.ts`

- [ ] **Step 1: Замер до.** `bun run build:web 2>&1 | tail -15` — записать размеры чанков (для отчёта).

- [ ] **Step 2: `App.tsx`**

```tsx
import { lazy, Suspense, useEffect, useMemo } from "react";
// убрать: import { CanvasView } from "./canvas/CanvasView"; и import Minimap from "./ui/Minimap";

const CanvasView = lazy(() => import("./canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const Minimap = lazy(() => import("./ui/Minimap"));
```

```tsx
      <Suspense fallback={null}>
        <CanvasView client={client} />
      </Suspense>
      …
        <div className={styles.topRight}>
          <AuthPanel />
          <Suspense fallback={null}>
            <Minimap />
          </Suspense>
        </div>
```

- [ ] **Step 3: Замер после.** `bun run build:web 2>&1 | tail -15`. Ожидание: отдельный чанк с PixiJS, основной — заметно меньше. Если предупреждение о >500 КБ осталось только для чанка PixiJS — поднять `build.chunkSizeWarningLimit` в `vite.config.ts` до ближайших 100 КБ над его размером с комментарием `// PixiJS alone; it is loaded lazily with the canvas.` Если основной чанк всё ещё > 500 КБ — **не** скрывать предупреждение, а разобраться, что туда попало (`build.rolldownOptions` не трогать без проверки документации Vite 8).

- [ ] **Step 4:** `bun run typecheck && bun test apps/web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/vite.config.ts
git commit -m "perf(web): load the canvas and the minimap lazily"
```

---

### Task 16: Проверка целиком и roadmap

- [ ] **Step 1:** `bun test` (все), `bun run typecheck`, `bun run build:web` — всё зелёное, числа записать.

- [ ] **Step 2: Браузер** (`bun run dev:server`, `bun run dev:web`, `http://localhost:5173/auth/dev?name=…`):
  1. Игрок `bob` (обычный): ставит пиксель с бомбой в клетке A.
  2. Игрок `alice`: 🔍 → клик рядом с A → тост «🔍 Бомб рядом: 1», цифра на клетке при зуме ≥ 6, наведение показывает «🔍 1 · только что»; режим вернулся в кисть; счётчик детекторов уменьшился.
  3. Перезагрузка страницы — цифра на месте (localStorage). Выйти/войти другим ником — цифр нет.
  4. 🧯 → клик по A → ConfirmBar «Обезвредить», подтверждение → «🧯 Бомба обезврежена! +20 монет».
  5. 🧯 без дефьюзеров → тост «Дефьюзеры закончились», режим не сбросился.
  6. Миникарта: видна на 1280×800, свёрнута на 375×812; клик переносит камеру; рамка вьюпорта двигается при панорамировании.
  7. Колесо мыши: ~1.5× за щелчок (синтетическим `WheelEvent` с `deltaY: 100` — проверить изменение `z` в URL).
  8. Часы: в консоли `gameStore` недоступен напрямую — проверить юнит-тестами (Task 2); вручную — нет ложных «Вы заморожены».
  9. 375×812: HUD, баннер заморозки (подорваться на чужой бомбе) и тосты не перекрываются; кнопки инструментов и свотчи помещаются (свотчи прокручиваются).
  10. Повторные клики без зарядов — один тост, а не стопка.

- [ ] **Step 3: Roadmap.** В `docs/superpowers/plans/2026-10-07-00-roadmap.md`: отметить План 3c выполненным (как предыдущие), добавить раздел «Заметки для Плана 4» с тем, что всплыло при ревью (как в прошлых планах), и отметить, что TanStack Query переносится в План 4.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-10-07-00-roadmap.md
git commit -m "docs: mark plan 3c done"
```

---

## Самопроверка плана

- Хвосты из «Заметок для Плана 3c»: часы — Task 1–2; монотонный таймаут и поздние `placed` — Task 3; дедуп тостов и live-регионы — Task 4; `title`, свотчи, Home/End, бомба при 0, сброс выбора мышью — Task 5; фиксированный отступ — Task 6; code splitting — Task 15. Плюс просьба пользователя про зум — Task 7.
- Спека: детектор (3×3, видно только игроку, localStorage с возрастом и затуханием, без синхронизации) — Task 9–12; дефьюзер — Task 10–11; миникарта — Task 13–14.
- Утечка бомб: `/overview` отдаёт только цвета, как `/chunk`; замеры хранятся только в браузере владельца.
- Порядок зависимостей: `api.ts` ссылается на `ToolsApi` → создаётся в Task 10; `ui-store` импортирует тип `Tool` из `game/tools.ts` (type-only, цикла в рантайме нет).
