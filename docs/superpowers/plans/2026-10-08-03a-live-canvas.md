# План 3a: Живой холст — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Браузерное приложение `apps/web` (Vite + React + PixiJS), которое показывает холст в реальном времени: загружает видимые чанки, применяет дельты по WebSocket с корректной синхронизацией версий, переживает переподключения и рестарты сервера, поддерживает зум/пан мышью и жестами, хранит позицию в URL. Без действий игрока — они в Плане 3b.

**Architecture:** Вся логика, которую можно проверить без браузера, — чистые модули с тестами (`bun test`): палитра → RGBA, математика камеры, автомат синхронизации чанка (`ChunkSync`), WebSocket-клиент с внедряемым транспортом (`GameSocket`), контроллер, связывающий их (`CanvasController`), zustand-стор. Pixi-рендерер и `CanvasSession` (жесты, URL, связка) — тонкие и проверяются вручную в браузере. React отвечает только за обвязку UI; холст рисуется императивно.

**Tech Stack:** Vite 8.3.3, React 19.3, PixiJS 8.22.0, zustand 5.0.15, CSS Modules, TypeScript 7, `bun test`.

**Спека:** `docs/superpowers/specs/2026-10-07-rave-battle-design.md` (3.7). **Роадмап:** `docs/superpowers/plans/2026-10-07-00-roadmap.md` («Заметки для Плана 3» — все пункты, относящиеся к холсту, учтены здесь).

**Проверено (2026-10-08, проба в scratchpad):** PixiJS 8.22 — `new BufferImageSource({ resource: Uint8Array, width, height, scaleMode: "nearest" })`, `new Texture({ source })`, `source.update()`, `app.init({ resizeTo, background, antialias })`, `app.canvas`, `Graphics().rect().stroke()` — проходят `tsc`. tRPC-клиент — в Плане 3b.

**Решения этого плана:**
- Разбивка: **3a** — холст «только смотреть»; **3b** — вход, палитра, пиксели/бомбы, детектор/дефьюзер, HUD, тосты, миникарта, tRPC + TanStack Query.
- Стили: CSS Modules + CSS-переменные неоновой темы (`src/theme.css`). Состояние: zustand (vanilla-стор + хук).
- Синхронизация чанка (правила из ревью Плана 2b):
  - пока чанк грузится по HTTP — дельты буферизуются;
  - `toVersion ≤ local` → отбросить; `fromVersion == local` → применить; иначе → перезагрузить (с сохранением вызвавшей дельты в буфере);
  - `subscribed`-подтверждение с версией > локальной → перезагрузить;
  - новый `bootId` → сбросить всё и перезагрузить видимое;
  - после переподключения все подписки новые, сервер подтверждает их версиями → устаревшие чанки перезагружаются сами.
- Видимые чанки = область экрана + 1 чанк запаса; не больше 64 (лимит сервера) — ближайшие к центру. Ушедшие из вида чанки выгружаются (текстура освобождается) и отписываются.
- Подписка отправляется только после `hello`; изменения подписки — не чаще раза в 150 мс (общий лимит сообщений сервера).
- Переподключение: экспоненциальный backoff 500 мс → 10 с, сброс после `hello`. Код 4001 (logout) и 1012 (рестарт) — тоже переподключение.
- Исправлено по ревью Task 1–4: `ChunkSync` запоминает наибольшую версию из `onAck`, пришедшую пока чанк грузится (`minVersion`), и после `onLoaded` перезагружает чанк, если итоговая версия ниже; `retry` переносит `minVersion`. `visibleChunks` при превышении лимита сначала берёт чанки, реально пересекающие экран (margin 0), и добирает запасом по близости к центру. Камера защищена от NaN (`zoomAt`/`pan`/`clampCenter` возвращают прежнюю камеру при нечисловых входах); `cameraFromSearch` отвергает пустые параметры. `apps/web` получает два tsconfig: прикладной (без `bun`-типов, без `*.test.ts`) и `tsconfig.test.json` (с `bun`); `typecheck` проверяет оба.
- Зум: от «холст целиком» (половина fit-зума) до 64×; сетка видна с 12×; пиксели чёткие (`scaleMode: "nearest"`, без сглаживания).
- Жесты: мышь — drag/колесо; touch — один палец пан, два — pinch-зум вокруг середины; `touch-action: none`. Тап/клик (сдвиг < 5 px, < 400 мс) передаётся наружу как выбор клетки (используется в 3b).
- URL: `?x=&y=&z=` (обновляется с задержкой 300 мс через `replaceState`).
- Dev: Vite-прокси `/trpc`, `/chunk`, `/auth`, `/ws` → `localhost:3000` без `changeOrigin` (Origin браузера должен дойти до сервера как есть).
- Типы: `apps/web` получает свой `tsconfig.json` (DOM + JSX); корневой `tsconfig.json` больше не включает `apps/web`; `bun run typecheck` проверяет оба.

---

## Файловая структура

```
rave-battle/
├── package.json                    + dev:web, build:web; typecheck проверяет и web
├── tsconfig.json                   include без apps/web
└── apps/web/
    ├── package.json                @rave/web
    ├── tsconfig.json               DOM, JSX, bun-types для тестов
    ├── vite.config.ts              React-плагин, прокси на :3000
    ├── index.html
    └── src/
        ├── main.tsx                точка входа
        ├── App.tsx (+ App.module.css)
        ├── theme.css               неоновые CSS-переменные, сброс
        ├── vite-env.d.ts
        ├── state/
        │   ├── game-store.ts       zustand: статус, hello, игрок, онлайн, hover
        │   └── game-store.test.ts
        ├── net/
        │   ├── socket.ts           GameSocket + браузерный транспорт
        │   └── socket.test.ts
        ├── canvas/
        │   ├── palette.ts          палитра → RGBA
        │   ├── palette.test.ts
        │   ├── viewport.ts         камера, видимые чанки, клетка под курсором, URL
        │   ├── viewport.test.ts
        │   ├── chunk-sync.ts       автомат версий чанка
        │   ├── chunk-sync.test.ts
        │   ├── controller.ts       связка sync ↔ загрузка ↔ рендер ↔ подписка
        │   ├── controller.test.ts
        │   ├── chunk-loader.ts     GET /chunk
        │   ├── pixi-renderer.ts    текстуры чанков, сетка, камера
        │   ├── session.ts          жесты, URL, связка с сокетом и стором
        │   └── CanvasView.tsx (+ CanvasView.module.css)
        └── ui/
            └── StatusBar.tsx (+ StatusBar.module.css)   подключение, онлайн, координаты
```

---

### Task 1: Каркас `apps/web`

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/App.module.css`, `apps/web/src/theme.css`, `apps/web/src/vite-env.d.ts`
- Modify: `package.json` (корень), `tsconfig.json` (корень)

- [ ] **Step 1: `apps/web/package.json`**

```json
{
  "name": "@rave/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@rave/shared": "workspace:*"
  }
}
```

Run:
```bash
bun add pixi.js@8.22.0 react@19.3.0 react-dom@19.3.0 zustand@5.0.15 --cwd apps/web
bun add -d vite@8.3.3 @vitejs/plugin-react@6.1.2 @types/react@19.3.0 @types/react-dom@19.3.0 --cwd apps/web
```
Проверить, что версии в `apps/web/package.json` записаны точно (без `^`); если `bun add` добавил `^` — убрать вручную. Если `@vitejs/plugin-react@6.1.2` требует другую версию Vite (peer-warning) — остановиться и сообщить.

- [ ] **Step 2: `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["bun", "vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```
(`bun`-типы нужны для `bun:test` в тестах. Если они конфликтуют с DOM-типами — сообщить, не отключать `strict`.)

- [ ] **Step 3: Корень**

`tsconfig.json` (корень): `"include": ["apps/server/src", "packages/*/src"]`.

`package.json` (корень), секция `scripts` — заменить `typecheck` и добавить два скрипта:
```json
    "typecheck": "tsc -p tsconfig.json && tsc -p apps/web/tsconfig.json",
    "dev:web": "bun run --cwd apps/web dev",
    "build:web": "bun run --cwd apps/web build",
```

- [ ] **Step 4: Vite и HTML**

`apps/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // No changeOrigin: the server checks the browser's Origin (http://localhost:5173).
    proxy: {
      "/trpc": SERVER,
      "/chunk": SERVER,
      "/auth": SERVER,
      "/ws": { target: SERVER, ws: true },
    },
  },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <meta name="theme-color" content="#07020f" />
    <title>Rave Battle</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 5: Тема и заглушка App**

`apps/web/src/theme.css`:
```css
:root {
  --bg: #07020f;
  --board-edge: #1a0b33;
  --panel: rgba(16, 6, 32, 0.78);
  --panel-border: rgba(255, 43, 214, 0.35);
  --neon-pink: #ff2bd6;
  --neon-cyan: #22f3ff;
  --neon-lime: #b6ff3b;
  --text: #f2e9ff;
  --muted: #9b8cb8;
  --radius: 12px;
  --glow-pink: 0 0 8px rgba(255, 43, 214, 0.7), 0 0 24px rgba(255, 43, 214, 0.35);
  --glow-cyan: 0 0 8px rgba(34, 243, 255, 0.7), 0 0 24px rgba(34, 243, 255, 0.3);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  overflow: hidden;
  overscroll-behavior: none;
}
```

`apps/web/src/App.module.css`:
```css
.app {
  position: fixed;
  inset: 0;
}
```

`apps/web/src/App.tsx` (временная версия; заменяется в Task 8):
```tsx
import styles from "./App.module.css";

export function App() {
  return <div className={styles.app}>Rave Battle</div>;
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Проверка**

Run:
```bash
bun install
bun run typecheck
bun run build:web
bun test
```
Expected: typecheck exit 0 (оба проекта); `vite build` создаёт `apps/web/dist`; `bun test` — 205 pass.

`apps/web/dist/` добавить в `.gitignore` (строка `dist/` уже покрывает — проверить `git status`).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json apps/web bun.lock
git commit -m "chore(web): scaffold vite react app"
```

---

### Task 2: Палитра → RGBA

**Files:**
- Create: `apps/web/src/canvas/palette.ts`
- Test: `apps/web/src/canvas/palette.test.ts`

- [ ] **Step 1: Тест**

```ts
import { describe, expect, test } from "bun:test";
import type { PaletteEntry } from "@rave/shared";
import { buildPaletteLut, paintCell, paintRgba } from "./palette";

const palette: PaletteEntry[] = [
  { id: 0, type: "solid", base: "#000000", params: {}, unlock: "default" },
  { id: 3, type: "solid", base: "#FF4500", params: {}, unlock: "default" },
];

describe("palette", () => {
  test("builds an RGBA lookup; unknown ids are transparent", () => {
    const lut = buildPaletteLut(palette);
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...lut.slice(12, 16)]).toEqual([255, 69, 0, 255]);
    expect([...lut.slice(40, 44)]).toEqual([0, 0, 0, 0]);
  });

  test("paintRgba converts a whole color buffer", () => {
    const out = new Uint8Array(8);
    paintRgba(new Uint8Array([3, 0]), buildPaletteLut(palette), out);
    expect([...out]).toEqual([255, 69, 0, 255, 0, 0, 0, 255]);
  });

  test("paintCell updates a single cell", () => {
    const out = new Uint8Array(8);
    paintCell(1, 3, buildPaletteLut(palette), out);
    expect([...out]).toEqual([0, 0, 0, 0, 255, 69, 0, 255]);
  });
});
```

- [ ] **Step 2: Запустить — FAIL** (`Cannot find module './palette'`).

Run: `bun test apps/web/src/canvas/palette.test.ts`

- [ ] **Step 3: Реализация** `apps/web/src/canvas/palette.ts`:
```ts
import type { PaletteEntry } from "@rave/shared";

/** 256 entries × RGBA. Ids missing from the palette stay transparent. Effects render with `base` in v1. */
export function buildPaletteLut(palette: PaletteEntry[]): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (const entry of palette) {
    const rgb = Number.parseInt(entry.base.slice(1), 16);
    lut.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], entry.id * 4);
  }
  return lut;
}

export function paintRgba(colors: Uint8Array, lut: Uint8Array, out: Uint8Array): void {
  for (let i = 0; i < colors.length; i++) paintCell(i, colors[i] ?? 0, lut, out);
}

export function paintCell(index: number, colorId: number, lut: Uint8Array, out: Uint8Array): void {
  const from = colorId * 4;
  const to = index * 4;
  out[to] = lut[from] ?? 0;
  out[to + 1] = lut[from + 1] ?? 0;
  out[to + 2] = lut[from + 2] ?? 0;
  out[to + 3] = lut[from + 3] ?? 0;
}
```

- [ ] **Step 4: PASS** (3 tests). **Step 5: Commit** — `feat(web): add palette to rgba conversion`

---

### Task 3: Камера и видимые чанки

**Files:**
- Create: `apps/web/src/canvas/viewport.ts`
- Test: `apps/web/src/canvas/viewport.test.ts`

- [ ] **Step 1: Тест**

```ts
import { describe, expect, test } from "bun:test";
import {
  cameraFromSearch,
  cameraToSearch,
  cellAt,
  clampCenter,
  fitZoom,
  pan,
  screenToWorld,
  visibleChunks,
  worldToScreen,
  zoomAt,
} from "./viewport";

const size = { w: 800, h: 600 };
const limits = { min: 0.5, max: 64 };

describe("viewport", () => {
  test("screen and world coordinates round-trip", () => {
    const cam = { x: 100, y: 50, zoom: 4 };
    const world = screenToWorld(cam, size, 500, 200);
    expect(world).toEqual({ x: 125, y: 25 });
    expect(worldToScreen(cam, size, world.x, world.y)).toEqual({ x: 500, y: 200 });
  });

  test("zoomAt keeps the point under the cursor fixed and clamps the zoom", () => {
    const cam = { x: 100, y: 100, zoom: 2 };
    const zoomed = zoomAt(cam, size, 600, 300, 2, limits);
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(zoomed, size, 600, 300)).toEqual(screenToWorld(cam, size, 600, 300));
    expect(zoomAt(cam, size, 0, 0, 1000, limits).zoom).toBe(64);
    expect(zoomAt(cam, size, 0, 0, 0.0001, limits).zoom).toBe(0.5);
  });

  test("pan moves the camera opposite to the drag", () => {
    expect(pan({ x: 10, y: 10, zoom: 2 }, 20, -10)).toEqual({ x: 0, y: 15, zoom: 2 });
  });

  test("clampCenter keeps the center on the canvas", () => {
    expect(clampCenter({ x: -5, y: 900, zoom: 1 }, { width: 512, height: 512 })).toEqual({ x: 0, y: 512, zoom: 1 });
  });

  test("fitZoom fits the whole canvas with a margin", () => {
    expect(fitZoom({ width: 512, height: 512 }, size)).toBeCloseTo((600 / 512) * 0.9);
  });

  test("visibleChunks covers the view plus a margin, clipped to the canvas, row by row", () => {
    expect(visibleChunks({ x: 256, y: 256, zoom: 1 }, size, { width: 512, height: 512 }, 0)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
    const zoomed = { x: 10, y: 10, zoom: 32 };
    expect(visibleChunks(zoomed, size, { width: 1024, height: 1024 }, 0)).toEqual([{ cx: 0, cy: 0 }]);
    expect(visibleChunks(zoomed, size, { width: 1024, height: 1024 }, 1)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
  });

  test("visibleChunks never exceeds the subscription limit and keeps the nearest chunks", () => {
    const chunks = visibleChunks({ x: 8192, y: 8192, zoom: 0.05 }, size, { width: 16_384, height: 16_384 }, 1);
    expect(chunks).toHaveLength(64);
    expect(chunks).toContainEqual({ cx: 32, cy: 32 });
  });

  test("cellAt returns the integer cell or null outside the canvas", () => {
    const cam = { x: 10, y: 10, zoom: 10 };
    expect(cellAt(cam, size, 400, 300, { width: 512, height: 512 })).toEqual({ x: 10, y: 10 });
    expect(cellAt(cam, size, 0, 0, { width: 512, height: 512 })).toBeNull();
  });

  test("the camera round-trips through the URL and garbage is ignored", () => {
    expect(cameraToSearch({ x: 12.345, y: 67.8, zoom: 8.123 })).toBe("?x=12&y=68&z=8.12");
    expect(cameraFromSearch("?x=12&y=68&z=8.12")).toEqual({ x: 12, y: 68, zoom: 8.12 });
    expect(cameraFromSearch("?x=abc&y=1&z=2")).toBeNull();
    expect(cameraFromSearch("?x=1&y=1&z=0")).toBeNull();
    expect(cameraFromSearch("")).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL** — `bun test apps/web/src/canvas/viewport.test.ts`.

- [ ] **Step 3: Реализация** `apps/web/src/canvas/viewport.ts`:
```ts
import { CHUNK_SIZE, MAX_SUBSCRIBED_CHUNKS } from "@rave/shared";

/** `x`, `y`: canvas coordinates at the screen center; `zoom`: screen pixels per canvas pixel. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ScreenSize {
  w: number;
  h: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export const MAX_ZOOM = 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function screenToWorld(cam: Camera, size: ScreenSize, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + (sx - size.w / 2) / cam.zoom, y: cam.y + (sy - size.h / 2) / cam.zoom };
}

export function worldToScreen(cam: Camera, size: ScreenSize, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + size.w / 2, y: (wy - cam.y) * cam.zoom + size.h / 2 };
}

/** Zooms by `factor` keeping the canvas point under (sx, sy) in place. */
export function zoomAt(cam: Camera, size: ScreenSize, sx: number, sy: number, factor: number, limits: ZoomLimits): Camera {
  const anchor = screenToWorld(cam, size, sx, sy);
  const zoom = clamp(cam.zoom * factor, limits.min, limits.max);
  return { x: anchor.x - (sx - size.w / 2) / zoom, y: anchor.y - (sy - size.h / 2) / zoom, zoom };
}

/** Drag by (dx, dy) screen pixels. */
export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
}

export function clampCenter(cam: Camera, canvas: CanvasSize): Camera {
  return { x: clamp(cam.x, 0, canvas.width), y: clamp(cam.y, 0, canvas.height), zoom: cam.zoom };
}

/** Zoom that shows the whole canvas with a 10% margin. */
export function fitZoom(canvas: CanvasSize, size: ScreenSize): number {
  return Math.min(size.w / canvas.width, size.h / canvas.height) * 0.9;
}

/**
 * Chunks intersecting the view, expanded by `margin` chunks, clipped to the canvas, row-major.
 * Capped at the server's subscription limit by keeping the chunks nearest to the view center.
 */
export function visibleChunks(cam: Camera, size: ScreenSize, canvas: CanvasSize, margin: number): Array<{ cx: number; cy: number }> {
  const topLeft = screenToWorld(cam, size, 0, 0);
  const bottomRight = screenToWorld(cam, size, size.w, size.h);
  const maxCx = canvas.width / CHUNK_SIZE - 1;
  const maxCy = canvas.height / CHUNK_SIZE - 1;
  const cx0 = clamp(Math.floor(topLeft.x / CHUNK_SIZE) - margin, 0, maxCx);
  const cy0 = clamp(Math.floor(topLeft.y / CHUNK_SIZE) - margin, 0, maxCy);
  const cx1 = clamp(Math.ceil(bottomRight.x / CHUNK_SIZE) - 1 + margin, 0, maxCx);
  const cy1 = clamp(Math.ceil(bottomRight.y / CHUNK_SIZE) - 1 + margin, 0, maxCy);

  const chunks: Array<{ cx: number; cy: number }> = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) chunks.push({ cx, cy });
  if (chunks.length <= MAX_SUBSCRIBED_CHUNKS) return chunks;

  const centerCx = cam.x / CHUNK_SIZE - 0.5;
  const centerCy = cam.y / CHUNK_SIZE - 0.5;
  const distance = (c: { cx: number; cy: number }) => (c.cx - centerCx) ** 2 + (c.cy - centerCy) ** 2;
  return chunks.sort((a, b) => distance(a) - distance(b)).slice(0, MAX_SUBSCRIBED_CHUNKS);
}

export function cellAt(cam: Camera, size: ScreenSize, sx: number, sy: number, canvas: CanvasSize): { x: number; y: number } | null {
  const world = screenToWorld(cam, size, sx, sy);
  const x = Math.floor(world.x);
  const y = Math.floor(world.y);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

export function cameraToSearch(cam: Camera): string {
  return `?x=${Math.round(cam.x)}&y=${Math.round(cam.y)}&z=${Number(cam.zoom.toFixed(2))}`;
}

/** Parses `?x=&y=&z=`; null when anything is missing or invalid. Clamping is the caller's job. */
export function cameraFromSearch(search: string): Camera | null {
  const params = new URLSearchParams(search);
  const values = ["x", "y", "z"].map((key) => (params.has(key) ? Number(params.get(key)) : Number.NaN));
  const [x, y, zoom] = values as [number, number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return null;
  return { x, y, zoom };
}
```
`MAX_SUBSCRIBED_CHUNKS` уже экспортируется из `@rave/shared` (protocol.ts).

Проверка ожиданий теста «visibleChunks»: для `{x:256,y:256,zoom:1}` и 800×600 видимая область x ∈ [−144, 656], y ∈ [−44, 556] → чанки 0..1 по обеим осям ✓; `Math.ceil(bottomRight/256) - 1` даёт последний чанк, который область действительно пересекает.

- [ ] **Step 4: PASS** (9 tests). **Step 5: Commit** — `feat(web): add camera math and visible chunk selection`

---

### Task 4: Автомат синхронизации чанка

**Files:**
- Create: `apps/web/src/canvas/chunk-sync.ts`
- Test: `apps/web/src/canvas/chunk-sync.test.ts`

- [ ] **Step 1: Тест**

```ts
import { describe, expect, test } from "bun:test";
import type { ChunkDelta } from "@rave/shared";
import { ChunkSync } from "./chunk-sync";

const delta = (fromVersion: number, toVersion: number, cells = [{ index: 1, colorId: 5 }]): ChunkDelta => ({
  cx: 0,
  cy: 0,
  fromVersion,
  toVersion,
  cells,
});
const colors = new Uint8Array(4);

function readyAt(version: number) {
  const sync = new ChunkSync();
  sync.track(0, 0);
  sync.onLoaded(0, 0, 1, version, colors);
  return sync;
}

describe("ChunkSync", () => {
  test("tracking a chunk requests one load", () => {
    const sync = new ChunkSync();
    expect(sync.track(0, 0)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 1 }]);
    expect(sync.track(0, 0)).toEqual([]);
  });

  test("a loaded chunk is replaced and then follows deltas", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([{ type: "replace", cx: 0, cy: 0, colors }]);
    expect(sync.onDelta(delta(3, 4))).toEqual([{ type: "apply", cx: 0, cy: 0, cells: [{ index: 1, colorId: 5 }] }]);
  });

  test("deltas buffered while loading are replayed or dropped by version", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onDelta(delta(2, 3));
    sync.onDelta(delta(3, 4, [{ index: 2, colorId: 6 }]));
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "apply", cx: 0, cy: 0, cells: [{ index: 2, colorId: 6 }] },
    ]);
    expect(sync.onDelta(delta(4, 5))).toHaveLength(1);
  });

  test("a gap in the buffered deltas triggers a reload", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onDelta(delta(5, 6));
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "load", cx: 0, cy: 0, requestId: 2 },
    ]);
  });

  test("stale deltas are dropped; a gap reloads and keeps the delta for replay", () => {
    const sync = readyAt(3);
    expect(sync.onDelta(delta(2, 3))).toEqual([]);
    expect(sync.onDelta(delta(5, 6))).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
    expect(sync.onLoaded(0, 0, 2, 5, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "apply", cx: 0, cy: 0, cells: [{ index: 1, colorId: 5 }] },
    ]);
  });

  test("an acknowledged version above the local one reloads a ready chunk", () => {
    const sync = readyAt(3);
    expect(sync.onAck(0, 0, 3)).toEqual([]);
    expect(sync.onAck(0, 0, 4)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
  });

  test("results of superseded loads are ignored", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.untrack(0, 0);
    sync.track(0, 0);
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([]);
    expect(sync.onLoaded(0, 0, 2, 3, colors)).toHaveLength(1);
  });

  test("untracked chunks ignore deltas and acks", () => {
    const sync = readyAt(3);
    sync.untrack(0, 0);
    expect(sync.onDelta(delta(3, 4))).toEqual([]);
    expect(sync.onAck(0, 0, 9)).toEqual([]);
  });

  test("retry reissues only the current failed load; reset forgets everything", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    expect(sync.retry(0, 0, 1)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
    expect(sync.retry(0, 0, 1)).toEqual([]);
    sync.reset();
    expect(sync.onDelta(delta(0, 1))).toEqual([]);
    expect(sync.track(0, 0)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 3 }]);
  });
});
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `apps/web/src/canvas/chunk-sync.ts`:
```ts
import type { ChunkDelta } from "@rave/shared";

export type SyncAction =
  | { type: "load"; cx: number; cy: number; requestId: number }
  | { type: "replace"; cx: number; cy: number; colors: Uint8Array }
  | { type: "apply"; cx: number; cy: number; cells: ChunkDelta["cells"] };

type Entry =
  | { status: "loading"; requestId: number; buffered: ChunkDelta[] }
  | { status: "ready"; version: number };

const key = (cx: number, cy: number) => `${cx}:${cy}`;

/**
 * Per-chunk version bookkeeping. Deltas carry absolute cell values and a `from → to` version pair;
 * the HTTP chunk body carries the version it reflects. Pure: returns actions for the caller to run.
 */
export class ChunkSync {
  private entries = new Map<string, Entry>();
  private nextRequestId = 1;

  track(cx: number, cy: number): SyncAction[] {
    if (this.entries.has(key(cx, cy))) return [];
    return this.startLoad(cx, cy, []);
  }

  untrack(cx: number, cy: number): void {
    this.entries.delete(key(cx, cy));
  }

  reset(): void {
    this.entries.clear();
  }

  onLoaded(cx: number, cy: number, requestId: number, version: number, colors: Uint8Array): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry || entry.status !== "loading" || entry.requestId !== requestId) return [];
    const actions: SyncAction[] = [{ type: "replace", cx, cy, colors }];
    let current = version;
    // Deltas of one chunk arrive in version order on a single socket.
    for (const d of entry.buffered) {
      if (d.toVersion <= current) continue;
      if (d.fromVersion !== current) return [...actions, ...this.startLoad(cx, cy, [])];
      actions.push({ type: "apply", cx, cy, cells: d.cells });
      current = d.toVersion;
    }
    this.entries.set(key(cx, cy), { status: "ready", version: current });
    return actions;
  }

  onDelta(d: ChunkDelta): SyncAction[] {
    const entry = this.entries.get(key(d.cx, d.cy));
    if (!entry) return [];
    if (entry.status === "loading") {
      entry.buffered.push(d);
      return [];
    }
    if (d.toVersion <= entry.version) return [];
    if (d.fromVersion === entry.version) {
      entry.version = d.toVersion;
      return [{ type: "apply", cx: d.cx, cy: d.cy, cells: d.cells }];
    }
    // Missed something: reload, keeping this delta in case the body is older than it.
    return this.startLoad(d.cx, d.cy, [d]);
  }

  /** Subscription acknowledgement: the server's current version of a newly subscribed chunk. */
  onAck(cx: number, cy: number, version: number): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry || entry.status !== "ready" || version <= entry.version) return [];
    return this.startLoad(cx, cy, []);
  }

  /** Re-requests a load that failed, unless it was superseded meanwhile. */
  retry(cx: number, cy: number, requestId: number): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry || entry.status !== "loading" || entry.requestId !== requestId) return [];
    return this.startLoad(cx, cy, entry.buffered);
  }

  private startLoad(cx: number, cy: number, buffered: ChunkDelta[]): SyncAction[] {
    const requestId = this.nextRequestId++;
    this.entries.set(key(cx, cy), { status: "loading", requestId, buffered });
    return [{ type: "load", cx, cy, requestId }];
  }
}
```

- [ ] **Step 4: PASS** (9 tests). **Step 5: Commit** — `feat(web): add chunk version synchronisation`

---

### Task 5: WebSocket-клиент

**Files:**
- Create: `apps/web/src/net/socket.ts`
- Test: `apps/web/src/net/socket.test.ts`

- [ ] **Step 1: Тест**

```ts
import { describe, expect, test } from "bun:test";
import { decodeClientMessage, defaultConfig, encodeChunkDelta, type ChunkDelta, type ServerMessage } from "@rave/shared";
import { GameSocket, type Timers, type TransportFactory, type TransportHandlers } from "./socket";

function harness() {
  const transports: Array<{ handlers: TransportHandlers; sent: Uint8Array[]; closed: boolean }> = [];
  const factory: TransportFactory = (_url, handlers) => {
    const transport = { handlers, sent: [] as Uint8Array[], closed: false };
    transports.push(transport);
    return { send: (data) => transport.sent.push(data), close: () => void (transport.closed = true) };
  };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const fakeTimers: Timers = {
    set: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clear: () => {},
  };
  const log: string[] = [];
  const deltas: ChunkDelta[] = [];
  const messages: ServerMessage[] = [];
  const socket = new GameSocket(
    "ws://test/ws",
    factory,
    {
      hello: (m) => log.push(`hello:${m.bootId}`),
      message: (m) => messages.push(m),
      delta: (d) => deltas.push(d),
      status: (s) => log.push(s),
      closed: (code) => log.push(`closed:${code}`),
    },
    { initialBackoffMs: 100, maxBackoffMs: 400, timers: fakeTimers },
  );
  return { socket, transports, timers, log, deltas, messages };
}

const hello = (bootId = "b1") =>
  JSON.stringify({ type: "hello", protocol: 1, bootId, user: null, config: defaultConfig, player: null } satisfies ServerMessage);

describe("GameSocket", () => {
  test("reports connecting, then open with hello", () => {
    const h = harness();
    h.socket.connect();
    h.transports[0]!.handlers.message(hello());
    expect(h.log).toEqual(["connecting", "open", "hello:b1"]);
  });

  test("subscriptions are sent only after hello, once per change", () => {
    const h = harness();
    h.socket.subscribe([{ cx: 0, cy: 0 }]);
    h.socket.connect();
    const t = h.transports[0]!;
    expect(t.sent).toHaveLength(0);
    t.handlers.message(hello());
    expect(t.sent.map(decodeClientMessage)).toEqual([{ op: 1, chunks: [{ cx: 0, cy: 0 }] }]);
    h.socket.subscribe([{ cx: 1, cy: 0 }]);
    expect(t.sent).toHaveLength(2);
  });

  test("binary frames become deltas, JSON becomes messages, garbage is ignored", () => {
    const h = harness();
    h.socket.connect();
    const t = h.transports[0]!;
    t.handlers.message(hello());
    const d: ChunkDelta = { cx: 1, cy: 2, fromVersion: 0, toVersion: 1, cells: [{ index: 3, colorId: 4 }] };
    t.handlers.message(encodeChunkDelta(d).buffer as ArrayBuffer);
    t.handlers.message(JSON.stringify({ type: "online", count: 3 }));
    t.handlers.message("{");
    expect(h.deltas).toEqual([d]);
    expect(h.messages).toEqual([{ type: "online", count: 3 }]);
  });

  test("reconnects with capped exponential backoff and resubscribes after hello", () => {
    const h = harness();
    h.socket.subscribe([{ cx: 0, cy: 0 }]);
    h.socket.connect();
    h.transports[0]!.handlers.message(hello());
    for (let i = 0; i < 4; i++) {
      h.transports[i]!.handlers.close(1006);
      h.timers[i]!.fn();
    }
    expect(h.timers.map((t) => t.ms)).toEqual([100, 200, 400, 400]);
    const fresh = h.transports[4]!;
    fresh.handlers.message(hello());
    expect(fresh.sent.map(decodeClientMessage)).toEqual([{ op: 1, chunks: [{ cx: 0, cy: 0 }] }]);
    fresh.handlers.close(1012);
    expect(h.timers[4]!.ms).toBe(100);
    expect(h.log).toContain("closed:1012");
    expect(h.log).toContain("reconnecting");
  });

  test("close() stops reconnecting", () => {
    const h = harness();
    h.socket.connect();
    h.socket.close();
    expect(h.transports[0]!.closed).toBe(true);
    h.transports[0]!.handlers.close(1000);
    expect(h.timers).toHaveLength(0);
    expect(h.log).toContain("closed");
  });
});
```

`Array.prototype.at` — ES2022, доступно.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `apps/web/src/net/socket.ts`:
```ts
import { decodeChunkDelta, encodeSubscribe, type ChunkDelta, type ServerMessage } from "@rave/shared";

export type HelloMessage = Extract<ServerMessage, { type: "hello" }>;
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface TransportHandlers {
  message(data: string | ArrayBuffer): void;
  close(code: number): void;
}

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
}

export type TransportFactory = (url: string, handlers: TransportHandlers) => Transport;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface GameSocketEvents {
  hello(message: HelloMessage): void;
  /** Every JSON message except `hello`. */
  message(message: ServerMessage): void;
  delta(delta: ChunkDelta): void;
  status(status: ConnectionStatus): void;
  closed?(code: number): void;
}

export interface GameSocketOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  timers?: Timers;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const browserTransport: TransportFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => handlers.message(event.data as string | ArrayBuffer);
  ws.onclose = (event) => handlers.close(event.code);
  return { send: (data) => ws.send(data), close: () => ws.close() };
};

/** Same-origin WebSocket URL (the Vite proxy forwards it in development). */
export function socketUrl(location: Location): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** Keeps one connection alive, re-subscribes after every `hello`, decodes frames. */
export class GameSocket {
  private transport: Transport | null = null;
  private ready = false;
  private chunks: Array<{ cx: number; cy: number }> = [];
  private attempt = 0;
  private timer: unknown = null;
  private stopped = false;
  private readonly timers: Timers;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly url: string,
    private readonly factory: TransportFactory,
    private readonly events: GameSocketEvents,
    options: GameSocketOptions = {},
  ) {
    this.timers = options.timers ?? browserTimers;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
  }

  connect(): void {
    if (this.transport || this.stopped) return;
    this.events.status(this.attempt === 0 ? "connecting" : "reconnecting");
    this.transport = this.factory(this.url, {
      message: (data) => this.receive(data),
      close: (code) => this.handleClose(code),
    });
  }

  /** Replaces the subscription set; sent now if the server already said hello, otherwise after it. */
  subscribe(chunks: Array<{ cx: number; cy: number }>): void {
    this.chunks = chunks;
    if (this.ready) this.transport?.send(encodeSubscribe(chunks));
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.transport?.close();
    this.transport = null;
    this.ready = false;
    this.events.status("closed");
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      const delta = decodeChunkDelta(new Uint8Array(data));
      if (delta) this.events.delta(delta);
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (message.type !== "hello") {
      this.events.message(message);
      return;
    }
    this.attempt = 0;
    this.events.status("open");
    // The hello handler may call subscribe(); it only records the set until we are ready.
    this.events.hello(message);
    this.ready = true;
    if (this.chunks.length > 0) this.transport?.send(encodeSubscribe(this.chunks));
  }

  private handleClose(code: number): void {
    this.transport = null;
    this.ready = false;
    this.events.closed?.(code);
    if (this.stopped) return;
    this.events.status("reconnecting");
    const delay = Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** this.attempt);
    this.attempt++;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }
}
```

Замечание: в первом тесте `status("connecting")` → `status("open")` → `hello`. При переподключении `connect()` шлёт `reconnecting` (уже отправлен в `handleClose`) — двойной `reconnecting` допустим.

- [ ] **Step 4: PASS** (5 tests). **Step 5: Commit** — `feat(web): add reconnecting websocket client`

---

### Task 6: Стор

**Files:**
- Create: `apps/web/src/state/game-store.ts`
- Test: `apps/web/src/state/game-store.test.ts`

- [ ] **Step 1: Тест**

```ts
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
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `apps/web/src/state/game-store.ts`:
```ts
import type { GameConfig, PlayerView, UserRef } from "@rave/shared";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ConnectionStatus, HelloMessage } from "../net/socket";

export interface GameState {
  status: ConnectionStatus;
  bootId: string | null;
  user: UserRef | null;
  player: PlayerView | null;
  config: GameConfig | null;
  online: number;
  /** Canvas cell under the pointer, for the status bar. */
  hover: { x: number; y: number } | null;
  applyHello(message: HelloMessage): void;
  setPlayer(player: PlayerView): void;
  setStatus(status: ConnectionStatus): void;
  setOnline(count: number): void;
  setHover(cell: { x: number; y: number } | null): void;
}

/** Vanilla store: readable from the canvas session and socket code outside React. */
export const gameStore = createStore<GameState>()((set) => ({
  status: "connecting",
  bootId: null,
  user: null,
  player: null,
  config: null,
  online: 0,
  hover: null,
  applyHello: (m) => set({ bootId: m.bootId, user: m.user, player: m.player, config: m.config }),
  setPlayer: (player) => set({ player }),
  setStatus: (status) => set({ status }),
  setOnline: (online) => set({ online }),
  setHover: (hover) => set({ hover }),
}));

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
```

- [ ] **Step 4: PASS** (2 tests). **Step 5: Commit** — `feat(web): add game state store`

---

### Task 7: Контроллер холста

**Files:**
- Create: `apps/web/src/canvas/controller.ts`
- Test: `apps/web/src/canvas/controller.test.ts`

- [ ] **Step 1: Тест**

```ts
import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import type { Timers } from "../net/socket";
import { CanvasController, type ChunkLoader, type Renderer } from "./controller";

function harness() {
  const calls: string[] = [];
  const renderer: Renderer = {
    setPalette: () => calls.push("palette"),
    setCanvasSize: (w, h) => calls.push(`size:${w}x${h}`),
    replaceChunk: (cx, cy, colors) => calls.push(`replace:${cx}:${cy}:${colors[0]}`),
    applyCells: (cx, cy, cells) => calls.push(`apply:${cx}:${cy}:${cells.map((c) => `${c.index}=${c.colorId}`).join(",")}`),
    dropChunk: (cx, cy) => calls.push(`drop:${cx}:${cy}`),
    dropAll: () => calls.push("dropAll"),
  };
  const loads: Array<{ cx: number; cy: number; resolve: (v: { version: number; colors: Uint8Array }) => void; reject: (e: unknown) => void }> = [];
  const loadChunk: ChunkLoader = (cx, cy) => new Promise((resolve, reject) => loads.push({ cx, cy, resolve, reject }));
  const subscriptions: string[][] = [];
  const retries: Array<() => void> = [];
  const timers: Timers = {
    set: (fn) => {
      retries.push(fn);
      return retries.length;
    },
    clear: () => {},
  };
  const controller = new CanvasController({
    renderer,
    loadChunk,
    socket: { subscribe: (chunks) => subscriptions.push(chunks.map((c) => `${c.cx}:${c.cy}`)) },
    retryMs: 10,
    timers,
  });
  return { controller, calls, loads, subscriptions, retries };
}

const hello = (bootId: string) => ({ bootId, config: defaultConfig });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CanvasController", () => {
  test("hello configures the palette and canvas size", () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    expect(h.calls).toEqual(["palette", "size:512x512"]);
  });

  test("visible chunks are subscribed and loaded", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    expect(h.subscriptions).toEqual([["0:0", "1:0"]]);
    expect(h.loads.map((l) => `${l.cx}:${l.cy}`)).toEqual(["0:0", "1:0"]);
    h.loads[0]!.resolve({ version: 2, colors: new Uint8Array([7]) });
    await flush();
    expect(h.calls).toContain("replace:0:0:7");
  });

  test("chunks leaving the view are dropped; an unchanged view does not resubscribe", () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.calls).toContain("drop:1:0");
    expect(h.subscriptions.at(-1)).toEqual(["0:0"]);
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.subscriptions).toHaveLength(2);
  });

  test("deltas and acks reach ready chunks", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.loads[0]!.resolve({ version: 2, colors: new Uint8Array([0]) });
    await flush();
    h.controller.onDelta({ cx: 0, cy: 0, fromVersion: 2, toVersion: 3, cells: [{ index: 5, colorId: 9 }] });
    expect(h.calls).toContain("apply:0:0:5=9");
    h.controller.onAck([{ cx: 0, cy: 0, version: 7 }]);
    expect(h.loads).toHaveLength(2);
  });

  test("a new boot id drops everything; the same boot id keeps chunks", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.controller.onHello(hello("b1"));
    expect(h.calls).not.toContain("dropAll");
    h.controller.onHello(hello("b2"));
    expect(h.calls).toContain("dropAll");
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.loads).toHaveLength(2);
    expect(h.subscriptions).toHaveLength(2);
  });

  test("failed loads are retried", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.loads[0]!.reject(new Error("offline"));
    await flush();
    expect(h.retries).toHaveLength(1);
    h.retries[0]!();
    expect(h.loads).toHaveLength(2);
  });
});
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `apps/web/src/canvas/controller.ts`:
```ts
import type { ChunkDelta, GameConfig } from "@rave/shared";
import type { Timers } from "../net/socket";
import { ChunkSync, type SyncAction } from "./chunk-sync";
import { buildPaletteLut } from "./palette";

export interface Renderer {
  setPalette(lut: Uint8Array): void;
  setCanvasSize(width: number, height: number): void;
  replaceChunk(cx: number, cy: number, colors: Uint8Array): void;
  applyCells(cx: number, cy: number, cells: ChunkDelta["cells"]): void;
  dropChunk(cx: number, cy: number): void;
  dropAll(): void;
}

export type ChunkLoader = (cx: number, cy: number) => Promise<{ version: number; colors: Uint8Array }>;

export interface ChunkSubscriber {
  subscribe(chunks: Array<{ cx: number; cy: number }>): void;
}

export interface ControllerDeps {
  renderer: Renderer;
  loadChunk: ChunkLoader;
  socket: ChunkSubscriber;
  retryMs?: number;
  timers?: Timers;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Glue between visible chunks, HTTP loads, deltas and the renderer. */
export class CanvasController {
  private sync = new ChunkSync();
  private bootId: string | null = null;
  private visible = new Set<string>();
  private readonly retryMs: number;
  private readonly timers: Timers;

  constructor(private readonly deps: ControllerDeps) {
    this.retryMs = deps.retryMs ?? 2000;
    this.timers = deps.timers ?? defaultTimers;
  }

  onHello(message: { bootId: string; config: GameConfig }): void {
    if (this.bootId !== null && this.bootId !== message.bootId) {
      // Versions from another server boot are meaningless: start over.
      this.sync.reset();
      this.deps.renderer.dropAll();
      this.visible.clear();
    }
    this.bootId = message.bootId;
    this.deps.renderer.setPalette(buildPaletteLut(message.config.palette));
    this.deps.renderer.setCanvasSize(message.config.canvas.width, message.config.canvas.height);
  }

  setVisible(chunks: Array<{ cx: number; cy: number }>): void {
    const next = new Set(chunks.map((c) => `${c.cx}:${c.cy}`));
    const changed = next.size !== this.visible.size || [...next].some((k) => !this.visible.has(k));
    if (!changed) return;
    for (const k of this.visible) {
      if (next.has(k)) continue;
      const [cx, cy] = k.split(":").map(Number) as [number, number];
      this.sync.untrack(cx, cy);
      this.deps.renderer.dropChunk(cx, cy);
    }
    for (const c of chunks) if (!this.visible.has(`${c.cx}:${c.cy}`)) this.run(this.sync.track(c.cx, c.cy));
    this.visible = next;
    this.deps.socket.subscribe(chunks);
  }

  onDelta(delta: ChunkDelta): void {
    this.run(this.sync.onDelta(delta));
  }

  onAck(chunks: Array<{ cx: number; cy: number; version: number }>): void {
    for (const c of chunks) this.run(this.sync.onAck(c.cx, c.cy, c.version));
  }

  private run(actions: SyncAction[]): void {
    for (const action of actions) {
      if (action.type === "load") this.load(action.cx, action.cy, action.requestId);
      else if (action.type === "replace") this.deps.renderer.replaceChunk(action.cx, action.cy, action.colors);
      else this.deps.renderer.applyCells(action.cx, action.cy, action.cells);
    }
  }

  private load(cx: number, cy: number, requestId: number): void {
    this.deps.loadChunk(cx, cy).then(
      ({ version, colors }) => this.run(this.sync.onLoaded(cx, cy, requestId, version, colors)),
      () => this.timers.set(() => this.run(this.sync.retry(cx, cy, requestId)), this.retryMs),
    );
  }
}
```

- [ ] **Step 4: PASS** (6 tests). **Step 5: Commit** — `feat(web): add canvas controller`

---

### Task 8: Рендерер, сессия, UI

Код этой задачи не покрыт юнит-тестами (WebGL и жесты) — проверяется сборкой, typecheck и вручную в Task 9.

**Files:**
- Create: `apps/web/src/canvas/chunk-loader.ts`, `apps/web/src/canvas/pixi-renderer.ts`, `apps/web/src/canvas/session.ts`, `apps/web/src/canvas/CanvasView.tsx`, `apps/web/src/canvas/CanvasView.module.css`, `apps/web/src/ui/StatusBar.tsx`, `apps/web/src/ui/StatusBar.module.css`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Загрузчик чанка** `apps/web/src/canvas/chunk-loader.ts`:
```ts
import { decodeChunkBody } from "@rave/shared";
import type { ChunkLoader } from "./controller";

export const fetchChunk: ChunkLoader = async (cx, cy) => {
  const res = await fetch(`/chunk/${cx}/${cy}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`chunk ${cx}:${cy}: HTTP ${res.status}`);
  const body = decodeChunkBody(new Uint8Array(await res.arrayBuffer()));
  if (!body) throw new Error(`chunk ${cx}:${cy}: malformed body`);
  return body;
};
```

- [ ] **Step 2: Рендерер** `apps/web/src/canvas/pixi-renderer.ts`:
```ts
import { CHUNK_SIZE } from "@rave/shared";
import { Application, BufferImageSource, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Renderer } from "./controller";
import { paintCell, paintRgba } from "./palette";
import type { Camera } from "./viewport";

interface ChunkView {
  colors: Uint8Array;
  rgba: Uint8Array;
  source: BufferImageSource;
  sprite: Sprite;
}

const GRID_MIN_ZOOM = 12;
const BOARD_COLOR = 0x000000;

export class PixiRenderer implements Renderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly board = new Graphics();
  private readonly grid = new Graphics();
  private readonly chunks = new Map<string, ChunkView>();
  private readonly dirty = new Set<ChunkView>();
  private lut = new Uint8Array(256 * 4);
  private canvasSize = { width: 0, height: 0 };
  private camera: Camera = { x: 0, y: 0, zoom: 1 };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: "#07020f", antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.board);
    this.app.stage.addChild(this.world, this.grid);
    this.app.ticker.add(() => this.flush());
    // Textures live in CPU buffers; after a context loss everything is re-uploaded from them.
    this.app.canvas.addEventListener("webglcontextrestored", () => {
      for (const chunk of this.chunks.values()) this.dirty.add(chunk);
    });
  }

  get canvasElement(): HTMLCanvasElement {
    return this.app.canvas;
  }

  screenSize(): { w: number; h: number } {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  setPalette(lut: Uint8Array): void {
    this.lut = lut;
    for (const chunk of this.chunks.values()) {
      paintRgba(chunk.colors, lut, chunk.rgba);
      this.dirty.add(chunk);
    }
  }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height };
    this.board.clear().rect(0, 0, width, height).fill(BOARD_COLOR);
  }

  replaceChunk(cx: number, cy: number, colors: Uint8Array): void {
    const chunk = this.chunks.get(`${cx}:${cy}`) ?? this.createChunk(cx, cy);
    chunk.colors.set(colors);
    paintRgba(chunk.colors, this.lut, chunk.rgba);
    this.dirty.add(chunk);
  }

  applyCells(cx: number, cy: number, cells: Array<{ index: number; colorId: number }>): void {
    const chunk = this.chunks.get(`${cx}:${cy}`);
    if (!chunk) return;
    for (const cell of cells) {
      chunk.colors[cell.index] = cell.colorId;
      paintCell(cell.index, cell.colorId, this.lut, chunk.rgba);
    }
    this.dirty.add(chunk);
  }

  dropChunk(cx: number, cy: number): void {
    const key = `${cx}:${cy}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.dirty.delete(chunk);
    chunk.sprite.destroy({ texture: true, textureSource: true });
    this.chunks.delete(key);
  }

  dropAll(): void {
    for (const key of [...this.chunks.keys()]) {
      const [cx, cy] = key.split(":").map(Number) as [number, number];
      this.dropChunk(cx, cy);
    }
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    const { width, height } = this.app.screen;
    this.world.scale.set(camera.zoom);
    this.world.position.set(Math.round(width / 2 - camera.x * camera.zoom), Math.round(height / 2 - camera.y * camera.zoom));
    this.drawGrid();
  }

  private createChunk(cx: number, cy: number): ChunkView {
    const colors = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const rgba = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
    const source = new BufferImageSource({ resource: rgba, width: CHUNK_SIZE, height: CHUNK_SIZE, scaleMode: "nearest" });
    const sprite = new Sprite(new Texture({ source }));
    sprite.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
    this.world.addChild(sprite);
    const chunk = { colors, rgba, source, sprite };
    this.chunks.set(`${cx}:${cy}`, chunk);
    return chunk;
  }

  private flush(): void {
    for (const chunk of this.dirty) chunk.source.update();
    this.dirty.clear();
  }

  /** Cell grid in screen space, only when zoomed in far enough to be useful. */
  private drawGrid(): void {
    this.grid.clear();
    const { zoom, x, y } = this.camera;
    if (zoom < GRID_MIN_ZOOM) return;
    const { width, height } = this.app.screen;
    const left = Math.max(0, Math.floor(x - width / 2 / zoom));
    const top = Math.max(0, Math.floor(y - height / 2 / zoom));
    const right = Math.min(this.canvasSize.width, Math.ceil(x + width / 2 / zoom));
    const bottom = Math.min(this.canvasSize.height, Math.ceil(y + height / 2 / zoom));
    const toScreenX = (wx: number) => Math.round((wx - x) * zoom + width / 2) + 0.5;
    const toScreenY = (wy: number) => Math.round((wy - y) * zoom + height / 2) + 0.5;
    for (let gx = left; gx <= right; gx++) this.grid.moveTo(toScreenX(gx), toScreenY(top)).lineTo(toScreenX(gx), toScreenY(bottom));
    for (let gy = top; gy <= bottom; gy++) this.grid.moveTo(toScreenX(left), toScreenY(gy)).lineTo(toScreenX(right), toScreenY(gy));
    this.grid.stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
  }
}
```
Если сигнатура `app.destroy(...)` / `sprite.destroy(...)` в 8.22 отличается — привести к фактическим типам и сообщить.

- [ ] **Step 3: Сессия** `apps/web/src/canvas/session.ts`:
```ts
import type { ServerMessage } from "@rave/shared";
import { browserTransport, GameSocket, socketUrl, type HelloMessage } from "../net/socket";
import { gameStore } from "../state/game-store";
import { fetchChunk } from "./chunk-loader";
import { CanvasController } from "./controller";
import { PixiRenderer } from "./pixi-renderer";
import {
  cameraFromSearch,
  cameraToSearch,
  cellAt,
  clampCenter,
  fitZoom,
  MAX_ZOOM,
  pan,
  visibleChunks,
  zoomAt,
  type Camera,
  type CanvasSize,
} from "./viewport";

export interface SessionCallbacks {
  /** A tap/click on a canvas cell (used by Plan 3b for placing). */
  onCellTap?(cell: { x: number; y: number }): void;
}

const TAP_MAX_MOVE = 5;
const TAP_MAX_MS = 400;
const SUBSCRIBE_THROTTLE_MS = 150;
const URL_DEBOUNCE_MS = 300;

/** Owns the renderer, the socket and all pointer handling for one mounted canvas. */
export class CanvasSession {
  private readonly renderer = new PixiRenderer();
  private readonly socket: GameSocket;
  private controller: CanvasController | null = null;
  private camera: Camera | null = null;
  private canvas: CanvasSize | null = null;
  private disposed = false;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private tapStart: { x: number; y: number; at: number } | null = null;
  private moved = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: SessionCallbacks = {},
  ) {
    this.socket = new GameSocket(socketUrl(window.location), browserTransport, {
      hello: (m) => this.onHello(m),
      message: (m) => this.onMessage(m),
      delta: (d) => this.controller?.onDelta(d),
      status: (s) => gameStore.getState().setStatus(s),
    });
    this.resizeObserver = new ResizeObserver(() => this.applyCamera());
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.socket.close();
    this.resizeObserver.disconnect();
    if (this.viewTimer) clearTimeout(this.viewTimer);
    if (this.urlTimer) clearTimeout(this.urlTimer);
    if (this.controller) this.renderer.destroy();
  }

  private async start(): Promise<void> {
    await this.renderer.init(this.host);
    if (this.disposed) {
      this.renderer.destroy();
      return;
    }
    this.controller = new CanvasController({ renderer: this.renderer, loadChunk: fetchChunk, socket: this.socket });
    this.attachPointerHandlers(this.renderer.canvasElement);
    this.resizeObserver.observe(this.host);
    this.socket.connect();
  }

  private onHello(message: HelloMessage): void {
    gameStore.getState().applyHello(message);
    this.canvas = message.config.canvas;
    this.controller?.onHello(message);
    if (!this.camera) {
      const size = this.renderer.screenSize();
      const fromUrl = cameraFromSearch(window.location.search);
      this.camera = fromUrl ?? { x: this.canvas.width / 2, y: this.canvas.height / 2, zoom: fitZoom(this.canvas, size) };
    }
    this.applyCamera(true);
  }

  private onMessage(message: ServerMessage): void {
    const store = gameStore.getState();
    if (message.type === "player") store.setPlayer(message.player);
    else if (message.type === "online") store.setOnline(message.count);
    else if (message.type === "subscribed") this.controller?.onAck(message.chunks);
    // "placed" and "feed" are handled in Plan 3b.
  }

  private zoomLimits() {
    const size = this.renderer.screenSize();
    return { min: this.canvas ? fitZoom(this.canvas, size) / 2 : 0.1, max: MAX_ZOOM };
  }

  /** Clamps, renders and (throttled) updates subscriptions and the URL. */
  private applyCamera(immediateView = false): void {
    if (!this.camera || !this.canvas || !this.controller) return;
    const limits = this.zoomLimits();
    const clampedZoom = Math.min(limits.max, Math.max(limits.min, this.camera.zoom));
    this.camera = clampCenter({ ...this.camera, zoom: clampedZoom }, this.canvas);
    this.renderer.setCamera(this.camera);
    if (immediateView) this.updateView();
    else if (!this.viewTimer) {
      this.viewTimer = setTimeout(() => {
        this.viewTimer = null;
        this.updateView();
      }, SUBSCRIBE_THROTTLE_MS);
    }
    if (this.urlTimer) clearTimeout(this.urlTimer);
    this.urlTimer = setTimeout(() => {
      if (this.camera) window.history.replaceState(null, "", cameraToSearch(this.camera));
    }, URL_DEBOUNCE_MS);
  }

  private updateView(): void {
    if (!this.camera || !this.canvas || !this.controller) return;
    this.controller.setVisible(visibleChunks(this.camera, this.renderer.screenSize(), this.canvas, 1));
  }

  private local(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.renderer.canvasElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private attachPointerHandlers(element: HTMLCanvasElement): void {
    element.style.touchAction = "none";

    element.addEventListener("pointerdown", (event) => {
      element.setPointerCapture(event.pointerId);
      const point = this.local(event);
      this.pointers.set(event.pointerId, point);
      if (this.pointers.size === 1) {
        this.tapStart = { ...point, at: performance.now() };
        this.moved = false;
      } else {
        this.tapStart = null;
      }
    });

    element.addEventListener("pointermove", (event) => {
      const point = this.local(event);
      if (this.camera && this.canvas) gameStore.getState().setHover(cellAt(this.camera, this.renderer.screenSize(), point.x, point.y, this.canvas));
      const previous = this.pointers.get(event.pointerId);
      if (!previous || !this.camera) return;

      if (this.pointers.size === 1) {
        if (this.tapStart && Math.hypot(point.x - this.tapStart.x, point.y - this.tapStart.y) > TAP_MAX_MOVE) this.moved = true;
        if (this.moved) this.camera = pan(this.camera, point.x - previous.x, point.y - previous.y);
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const before = { mid: midpoint(previous, other), dist: distance(previous, other) };
          const after = { mid: midpoint(point, other), dist: distance(point, other) };
          if (before.dist > 0) {
            this.camera = zoomAt(this.camera, this.renderer.screenSize(), after.mid.x, after.mid.y, after.dist / before.dist, this.zoomLimits());
          }
          this.camera = pan(this.camera, after.mid.x - before.mid.x, after.mid.y - before.mid.y);
          this.moved = true;
        }
      }
      this.pointers.set(event.pointerId, point);
      this.applyCamera();
    });

    const release = (event: PointerEvent) => {
      const wasTracked = this.pointers.delete(event.pointerId);
      const tap = this.tapStart;
      if (!wasTracked || this.pointers.size > 0) return;
      this.tapStart = null;
      if (event.type !== "pointerup" || this.moved || !tap || performance.now() - tap.at > TAP_MAX_MS) return;
      if (!this.camera || !this.canvas) return;
      const cell = cellAt(this.camera, this.renderer.screenSize(), tap.x, tap.y, this.canvas);
      if (cell) this.callbacks.onCellTap?.(cell);
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    element.addEventListener("pointerleave", () => gameStore.getState().setHover(null));

    element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (!this.camera) return;
        const point = this.local(event);
        this.camera = zoomAt(this.camera, this.renderer.screenSize(), point.x, point.y, Math.exp(-event.deltaY * 0.0015), this.zoomLimits());
        this.applyCamera();
      },
      { passive: false },
    );
  }
}

const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
```

- [ ] **Step 4: React-обвязка**

`apps/web/src/canvas/CanvasView.module.css`:
```css
.host {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}

.host canvas {
  display: block;
  image-rendering: pixelated;
}
```

`apps/web/src/canvas/CanvasView.tsx`:
```tsx
import { useEffect, useRef } from "react";
import styles from "./CanvasView.module.css";
import { CanvasSession, type SessionCallbacks } from "./session";

/** Mounts one CanvasSession; everything inside is imperative. */
export function CanvasView(props: SessionCallbacks) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    const session = new CanvasSession(hostRef.current!, { onCellTap: (cell) => callbacks.current.onCellTap?.(cell) });
    return () => session.dispose();
  }, []);

  return <div ref={hostRef} className={styles.host} />;
}
```

`apps/web/src/ui/StatusBar.module.css`:
```css
.bar {
  position: absolute;
  left: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom));
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 12px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--muted);
  backdrop-filter: blur(6px);
  pointer-events: none;
  user-select: none;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}

.open {
  background: var(--neon-lime);
  box-shadow: 0 0 8px var(--neon-lime);
}

.reconnecting {
  background: var(--neon-pink);
  box-shadow: var(--glow-pink);
}

.coords {
  color: var(--neon-cyan);
  font-variant-numeric: tabular-nums;
}
```

`apps/web/src/ui/StatusBar.tsx`:
```tsx
import { useGame } from "../state/game-store";
import styles from "./StatusBar.module.css";

const LABELS = { connecting: "подключение…", open: "онлайн", reconnecting: "переподключение…", closed: "отключено" } as const;

export function StatusBar() {
  const status = useGame((s) => s.status);
  const online = useGame((s) => s.online);
  const hover = useGame((s) => s.hover);
  const dotClass = status === "open" ? styles.open : status === "reconnecting" ? styles.reconnecting : "";
  return (
    <div className={styles.bar}>
      <span className={`${styles.dot} ${dotClass}`} />
      <span>{status === "open" ? `${online} онлайн` : LABELS[status]}</span>
      {hover && (
        <span className={styles.coords}>
          {hover.x}, {hover.y}
        </span>
      )}
    </div>
  );
}
```

`apps/web/src/App.tsx`:
```tsx
import styles from "./App.module.css";
import { CanvasView } from "./canvas/CanvasView";
import { StatusBar } from "./ui/StatusBar";

export function App() {
  return (
    <div className={styles.app}>
      <CanvasView />
      <StatusBar />
    </div>
  );
}
```

`React.StrictMode` в dev монтирует эффекты дважды — `CanvasSession` корректно освобождает ресурсы в `dispose()`, в том числе если `init` ещё не завершился (флаг `disposed`).

- [ ] **Step 5: Проверка**

Run: `bun run typecheck && bun run build:web && bun test`
Expected: typecheck exit 0; сборка успешна; тесты — 205 + 34 = **239** pass.

- [ ] **Step 6: Commit** — `feat(web): render the live canvas with pan and zoom`

---

### Task 9: Проверка в браузере

- [ ] **Step 1: Запуск**

В двух фоновых процессах (логи в `tmp/`):
```bash
bun run dev:server > tmp/server-3a.log 2>&1 &
bun run dev:web > tmp/web-3a.log 2>&1 &
```
Дождаться `listening on :3000` и `Local: http://localhost:5173`.

- [ ] **Step 2: Прокси и протокол без браузера**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/chunk/0/0
curl -s http://localhost:5173/trpc/me
```
Expected: `200`, `{"result":{"data":null}}`.

- [ ] **Step 3: Живое обновление**

Скрипт `tmp/paint-3a.ts` (не коммитится): dev-логин через `http://localhost:5173/auth/dev?name=painter` (redirect: manual), WebSocket на `ws://localhost:5173/ws` с `Origin: http://localhost:5173` и cookie, дождаться `hello`, поставить 20 пикселей разных цветов в квадрате (100..104, 100..103), дождаться `placed` на каждый. Открыть `http://localhost:5173/?x=102&y=102&z=24` в браузере и убедиться (скриншот), что пиксели видны, сетка видна, статус «онлайн». Запустить скрипт второй раз с другими цветами при открытой странице — пиксели меняются без перезагрузки.

- [ ] **Step 4: Рестарт сервера**

При открытой странице перезапустить сервер (SIGINT, затем снова `bun run dev:server`): статус проходит «переподключение…» → «онлайн», холст остаётся корректным; после повторного запуска скрипта изменения видны.

- [ ] **Step 5: Мобильная ширина**

Эмуляция 375×812: холст на весь экран, статус-бар не перекрывает safe area, pinch/drag работают (в эмуляторе — колесо/drag как минимум).

- [ ] **Step 6: Остановить процессы**, убедиться, что порты 3000 и 5173 свободны.

Найденные проблемы исправляются отдельными коммитами с тестами там, где логика тестируема.

---

## Итог

Ожидаемо после Task 8: **239** тестов (205 + palette 3 + viewport 9 + chunk-sync 9 + socket 5 + store 2 + controller 6), typecheck обоих проектов чистый, `vite build` успешен.
