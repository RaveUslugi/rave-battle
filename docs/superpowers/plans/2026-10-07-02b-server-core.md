# План 2b: Ядро сервера — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запускаемый сервер на `Bun.serve`: живой холст по WebSocket (подписка на чанки, установка пикселей, рассылка только закоммиченных изменений, лента без координат, онлайн-счётчик), загрузка чанков по HTTP, сессии на cookie и dev-вход, защита от второго экземпляра, graceful shutdown.

**Architecture:** `main.ts` берёт advisory-lock Postgres, применяет миграции, поднимает `GameRuntime` через `bootGame` и `Hub`. `Hub` — обработчики WebSocket и хук `onCommit` рантайма: всё, что уходит клиентам, строится из **закоммиченных** событий. Клиент → сервер: бинарные кадры (`SUBSCRIBE`, `PLACE`). Сервер → клиент: бинарный `CHUNK_DELTA` (горячий путь) и JSON-сообщения для редких событий. Протокол живёт в `@rave/shared`, чтобы клиент (План 3) использовал те же кодеки.

**Tech Stack:** Bun 1.3 (`Bun.serve`, нативные WebSocket + pub/sub, `Bun.gzipSync`, `Bun.CryptoHasher`), TypeScript 7, zod 4, drizzle + postgres.js.

**Спека:** `docs/superpowers/specs/2026-10-07-rave-battle-design.md` (3.3–3.6, 7, 8). **Роадмап:** `docs/superpowers/plans/2026-10-07-00-roadmap.md` («Заметки для Плана 2b»).

**Проверено по исходникам/документации (2026-10-07):** `bun-types@1.4.2` — тип `ws.data` задаётся через `Server<T>`/`WebSocketHandler<T>.data`, `fetch` при наличии `websocket` может вернуть `undefined` после `server.upgrade`, есть `server.publish`, `server.subscriberCount`, `server.requestIP`, клиентский `new WebSocket(url, { headers })`.

**Решения этого плана (уточняют спеку):**
- Разбивка: Discord OAuth и tRPC (магазин, дейлик, детектор, дефьюзер) — **План 2c**. Здесь вход только dev-логином (`DEV_LOGIN=1`, запрещён при `NODE_ENV=production`).
- Сервер → клиент: бинарный только `CHUNK_DELTA`; `hello`, `player`, `placed`, `feed`, `online` — JSON-текст. Клиент → сервер: только бинарные кадры; текстовый кадр или битый кадр закрывает сокет (1003).
- `CHUNK_DELTA` несёт абсолютные значения клеток и пару версий `from → to` (версия чанка = число разосланных по нему дельт с запуска сервера). Клиент при `from ≠ локальная версия` перезагружает чанк по HTTP. Версии в памяти; после рестарта клиент переподключается и перезагружает чанки.
- `GET /chunk/:cx/:cy` отдаёт цвета из памяти движка (могут включать ещё не закоммиченные пиксели — безопасно: дельты абсолютны и идемпотентны) + текущую версию; тело `u32 version + 65536 байт`, gzip.
- Владельцы клеток и бомбы клиенту не отправляются никогда.
- Сессия: случайный 32-байтный токен (base64url) в cookie `rb_session` (на https — `__Host-rb_session`, исправлено по ревью) (`HttpOnly`, `SameSite=Lax`, `Secure` при https), в БД хранится SHA-256 токена. TTL 30 дней.
- WebSocket: проверка `Origin` по списку (`PUBLIC_URL` + `ALLOWED_ORIGINS`) — защита от cross-site WebSocket hijacking; до 10 соединений с IP; token bucket 40 сообщений, +20/с на сокет, превышение → закрытие 1008.
- IP берётся из `server.requestIP`; доверие к `X-Forwarded-For` за Caddy — План 6.
- `guildMember = true` для всех в 2b (проверка гильдии — 2c).
- Writer-lock (исправлено по ревью Task 2): соединение без `max_lifetime`, heartbeat проверяет в `pg_locks`, что блокировка держится этой сессией; потеря → `onLost` → выход процесса.
- Исправлено по ревью Task 7:
  - слот лимита соединений на IP резервируется **синхронно** в `upgrade` до любого `await` и освобождается при неудачном upgrade или `close`;
  - бан из `users` передаётся при создании игрока (`NewPlayer.bannedUntil`);
  - сокет подписывается на `global`/`user:<id>` только после отправки `hello`; кадры, пришедшие до `hello`, ставятся в очередь (до 16, иначе 1008) и обрабатываются по порядку после него;
  - на каждый `SUBSCRIBE` сервер отвечает JSON `{type: "subscribed", chunks: [{cx, cy, version}]}` для **новых** чанков — клиент сверяет версию с загруженной и перезагружает чанк, если отстал;
  - `maxPayloadLength` WebSocket = 4096 байт (самый большой валидный кадр — 259 байт).
- Известное ограничение: `player`-сообщение строится из живого состояния движка и может включать эффекты ещё не закоммиченных команд того же игрока (только ему; координат не раскрывает).
- Исправления рантайма из ревью 2a: `onCommit`, флаг остановки, идемпотентный `addPlayer`, `try` вокруг `takeBatch`, `bootGame`, advisory-lock.

---

## Файловая структура

```
rave-battle/
├── .env.example                          + PORT, PUBLIC_URL, ALLOWED_ORIGINS, DEV_LOGIN, NODE_ENV
├── package.json                          + dev:server, start:server
├── packages/shared/src/
│   ├── protocol.ts                       кадры WS, JSON-сообщения, тело чанка
│   ├── protocol.test.ts
│   └── index.ts                          + export protocol
└── apps/server/src/
    ├── main.ts                           точка входа, shutdown
    ├── db/
    │   ├── writer-lock.ts                pg advisory lock
    │   └── writer-lock.test.ts
    ├── persistence/
    │   ├── runtime.ts                    + onCommit, stop-флаг, идемпотентный addPlayer
    │   ├── runtime.test.ts               + тесты
    │   ├── boot.ts                       bootGame(db, options)
    │   └── boot.test.ts
    ├── auth/
    │   ├── session.ts                    токены, cookie, resolveSession
    │   ├── users.ts                      upsertUser
    │   └── session.test.ts
    └── net/
        ├── env.ts                        loadEnv → ServerConfig
        ├── env.test.ts
        ├── rate-limit.ts                 TokenBucket
        ├── rate-limit.test.ts
        ├── user-directory.ts             id → имя
        ├── views.ts                      PlayerView, PlaceResultView, дельты, лента
        ├── views.test.ts
        ├── hub.ts                        WebSocket + onCommit-рассылка
        ├── server.ts                     startServer: маршруты HTTP + /ws
        └── server.test.ts                интеграционные тесты через настоящий сокет
```

---

### Task 1: Доработки `GameRuntime`

**Files:**
- Modify: `apps/server/src/persistence/runtime.ts`
- Test: `apps/server/src/persistence/runtime.test.ts` (дописать)

- [ ] **Step 1: Дописать падающие тесты**

В конец `apps/server/src/persistence/runtime.test.ts`:
```ts
describe("GameRuntime hooks and lifecycle", () => {
  async function bootWith(options: { onCommit?: (events: EngineEvent[]) => void } = {}) {
    const { engine, seasonId, replayedChunks } = await loadGame(t.db, clock);
    return new GameRuntime(engine, t.db, {
      seasonId,
      now: () => clock,
      flushIntervalMs: 0,
      dirtyChunks: replayedChunks,
      onFatal: () => {},
      ...options,
    });
  }
  const join = (runtime: GameRuntime) =>
    runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });

  test("onCommit sees committed events before the command resolves", async () => {
    const seen: string[] = [];
    const runtime = await bootWith({ onCommit: (events) => seen.push(...events.map((e) => e.type)) });
    await join(runtime);
    const result = await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    expect(result).toEqual({ ok: true, outcome: "placed" });
    expect(seen).toContain("pixel");
  });

  test("a throwing onCommit does not break commands", async () => {
    const runtime = await bootWith({
      onCommit: () => {
        throw new Error("boom");
      },
    });
    await join(runtime);
    expect(await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now))).toEqual({ ok: true, outcome: "placed" });
  });

  test("addPlayer returns the existing player instead of recreating it", async () => {
    const runtime = await bootWith();
    const first = await join(runtime);
    await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    const second = await join(runtime);
    expect(second).toBe(first);
    expect(second.coins).toBe(101);
    const start = await t.db.select().from(ledger).where(eq(ledger.reason, "start"));
    expect(start).toHaveLength(3);
  });

  test("after stop() new commands and players are rejected", async () => {
    const runtime = await bootWith();
    await join(runtime);
    await runtime.stop();
    await expect(runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now))).rejects.toThrow("shutting down");
    await expect(runtime.addPlayer({ userId: 999, accountCreatedAt: 0, guildMember: true })).rejects.toThrow("shutting down");
  });
});
```

Дополнить импорты в начале файла: `import { eq } from "drizzle-orm";`, `ledger` в импорт из `../db/schema`, `import type { EngineEvent } from "../engine/types";` (не дублировать уже существующие импорты — дописать в них).

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/persistence/runtime.test.ts`
Expected: FAIL — `onCommit` не вызывается (`seen` пуст), второй `addPlayer` создаёт новый объект, после `stop()` команды проходят.

- [ ] **Step 3: Реализовать**

В `apps/server/src/persistence/runtime.ts`:

1. Импорт типа событий:
```ts
import type { EngineEvent, PlayerState, UserId } from "../engine/types";
```

2. В `RuntimeOptions` добавить:
```ts
  /** Called after each successful commit with its events, before the commands resolve. */
  onCommit?: (events: EngineEvent[]) => void;
```

3. В класс — поля:
```ts
  private stopping = false;
  private readonly onCommit: ((events: EngineEvent[]) => void) | undefined;
```
и в конструкторе: `this.onCommit = options.onCommit;`

4. Заменить `run`, `addPlayer`, `stop`, `stoppedError` на:
```ts
  /** Executes `command` right away; resolves with its result once its effects are committed. */
  run<T>(command: (engine: GameEngine, now: number) => T): Promise<T> {
    const unavailable = this.unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    let result: T;
    try {
      result = command(this.engine, this.now());
    } catch (error) {
      return Promise.reject(error);
    }
    return this.afterCommit().then(() => result);
  }

  /** Returns the existing player, or creates one and resolves once it is persisted. */
  addPlayer(init: Omit<NewPlayer, "now">): Promise<PlayerState> {
    const unavailable = this.unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    if (this.engine.players.has(init.userId)) return Promise.resolve(this.engine.players.get(init.userId));
    const now = this.now();
    const player = createPlayer({ ...init, now }, this.engine.config);
    this.engine.players.add(player);
    this.newPlayers.push({ player: snapshotPlayer(player), at: now });
    return this.afterCommit().then(() => player);
  }

  /** Graceful shutdown: rejects new commands, commits everything pending and snapshots dirty chunks. */
  stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush({ snapshot: true });
  }

  private stoppedError(): Error {
    return new Error("Game runtime stopped after a persistence failure");
  }

  private unavailableError(): Error | null {
    if (this.failed) return this.stoppedError();
    if (this.stopping) return new Error("Game runtime is shutting down");
    return null;
  }
```

5. Заменить `commit` на:
```ts
  private async commit(forceSnapshot: boolean): Promise<void> {
    const waiters = this.waiters;
    this.waiters = [];
    if (this.failed) {
      const error = this.stoppedError();
      for (const w of waiters) w.reject(error);
      throw error;
    }
    let events: EngineEvent[] = [];
    try {
      const batch = this.takeBatch(forceSnapshot);
      if (batch) {
        events = batch.events;
        await this.db.transaction((tx) => writeBatch(tx, batch));
      }
    } catch (error) {
      this.failed = true;
      for (const w of waiters) w.reject(error);
      this.onFatal(error);
      throw error;
    }
    this.notifyCommitted(events);
    for (const w of waiters) w.resolve();
  }

  private notifyCommitted(events: EngineEvent[]): void {
    if (!this.onCommit || events.length === 0) return;
    try {
      this.onCommit(events);
    } catch (error) {
      console.error("onCommit handler failed", error);
    }
  }
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/persistence/runtime.test.ts`
Expected: PASS (все прежние + 4 новых).

- [ ] **Step 5: Весь набор и typecheck**

Run: `bun test && bun run typecheck`
Expected: 105 pass, 0 fail; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(persistence): add commit hook, idempotent players and shutdown guard"
```

---

### Task 2: Advisory-lock и `bootGame`

**Files:**
- Create: `apps/server/src/db/writer-lock.ts`, `apps/server/src/persistence/boot.ts`
- Test: `apps/server/src/db/writer-lock.test.ts`, `apps/server/src/persistence/boot.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/db/writer-lock.test.ts`:
```ts
import { expect, test } from "bun:test";
import { TEST_DATABASE_URL } from "./test-db";
import { acquireWriterLock } from "./writer-lock";

test("only one writer can hold the lock at a time", async () => {
  const first = await acquireWriterLock(TEST_DATABASE_URL);
  await expect(acquireWriterLock(TEST_DATABASE_URL)).rejects.toThrow("already running");
  await first.release();
  const again = await acquireWriterLock(TEST_DATABASE_URL);
  await again.release();
});
```

`apps/server/src/persistence/boot.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { createTestDb, insertUser } from "../db/test-db";
import { T0 } from "../engine/test-utils";
import { bootGame } from "./boot";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

test("bootGame wires loadGame into a runtime that survives restarts", async () => {
  const a = await insertUser(t.db, "a");
  const options = { now: () => T0, flushIntervalMs: 0, onFatal: () => {} };

  const first = await bootGame(t.db, options);
  await first.addPlayer({ userId: a, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
  await first.run((engine, now) => engine.placePixel(a, { x: 300, y: 300, colorId: 4, withBomb: false }, now));

  const second = await bootGame(t.db, options);
  expect(second.engine.canvas.get(300, 300)).toEqual({ colorId: 4, ownerId: a });
  await second.stop();
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `bun test apps/server/src/db/writer-lock.test.ts apps/server/src/persistence/boot.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать**

`apps/server/src/db/writer-lock.ts`:
```ts
import postgres from "postgres";

/** Arbitrary constant shared by all server instances ("RAVE"). */
const WRITER_LOCK_KEY = 0x52415645;

/**
 * The game state assumes a single writer. Holds a session-level advisory lock on a dedicated
 * connection for the process lifetime; a second instance fails to start.
 */
export async function acquireWriterLock(url: string): Promise<{ release: () => Promise<void> }> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const [row] = await sql<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${WRITER_LOCK_KEY}) as locked`;
  if (!row?.locked) {
    await sql.end();
    throw new Error("Another server instance is already running against this database");
  }
  return {
    release: async () => {
      await sql`select pg_advisory_unlock(${WRITER_LOCK_KEY})`;
      await sql.end();
    },
  };
}
```

`apps/server/src/persistence/boot.ts`:
```ts
import type { Db } from "../db/client";
import { loadGame } from "./load-game";
import { GameRuntime, type RuntimeOptions } from "./runtime";

export type BootOptions = Omit<RuntimeOptions, "seasonId" | "dirtyChunks">;

/** The only supported way to start the game: loads state and seeds the runtime with replayed chunks. */
export async function bootGame(db: Db, options: BootOptions = {}): Promise<GameRuntime> {
  const now = options.now ?? Date.now;
  const loaded = await loadGame(db, now());
  return new GameRuntime(loaded.engine, db, {
    ...options,
    now,
    seasonId: loaded.seasonId,
    dirtyChunks: loaded.replayedChunks,
  });
}
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `bun test apps/server/src/db/writer-lock.test.ts apps/server/src/persistence/boot.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/writer-lock.ts apps/server/src/db/writer-lock.test.ts apps/server/src/persistence/boot.ts apps/server/src/persistence/boot.test.ts
git commit -m "feat(server): add single-writer lock and bootGame"
```

---

### Task 3: Протокол в `@rave/shared`

**Files:**
- Create: `packages/shared/src/protocol.ts`
- Test: `packages/shared/src/protocol.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Написать падающие тесты**

`packages/shared/src/protocol.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { CHUNK_SIZE } from "./constants";
import {
  ClientOp,
  decodeChunkBody,
  decodeChunkDelta,
  decodeClientMessage,
  encodeChunkBody,
  encodeChunkDelta,
  encodePlace,
  encodeSubscribe,
  MAX_SUBSCRIBED_CHUNKS,
} from "./protocol";

describe("client frames", () => {
  test("place round-trips", () => {
    const frame = encodePlace({ reqId: 7, x: 70_000, y: 3, colorId: 31, withBomb: true });
    expect(decodeClientMessage(frame)).toEqual({ op: ClientOp.Place, reqId: 7, x: 70_000, y: 3, colorId: 31, withBomb: true });
  });

  test("subscribe round-trips", () => {
    const frame = encodeSubscribe([{ cx: 0, cy: 1 }, { cx: 2, cy: 3 }]);
    expect(decodeClientMessage(frame)).toEqual({ op: ClientOp.Subscribe, chunks: [{ cx: 0, cy: 1 }, { cx: 2, cy: 3 }] });
  });

  test("decodes frames that are views into a larger buffer", () => {
    const frame = encodePlace({ reqId: 1, x: 2, y: 3, colorId: 4, withBomb: false });
    const padded = new Uint8Array(frame.length + 5);
    padded.set(frame, 5);
    expect(decodeClientMessage(padded.subarray(5))).toMatchObject({ reqId: 1, x: 2, y: 3, colorId: 4 });
  });

  test("malformed frames decode to null", () => {
    const place = encodePlace({ reqId: 1, x: 2, y: 3, colorId: 4, withBomb: false });
    const badFlags = place.slice();
    badFlags[14] = 2;
    const tooMany = encodeSubscribe(Array.from({ length: MAX_SUBSCRIBED_CHUNKS + 1 }, () => ({ cx: 0, cy: 0 })));
    for (const frame of [new Uint8Array(0), new Uint8Array([99]), place.slice(0, 10), badFlags, tooMany, encodeSubscribe([{ cx: 1, cy: 1 }]).slice(0, 5)]) {
      expect(decodeClientMessage(frame)).toBeNull();
    }
  });
});

describe("server frames", () => {
  test("chunk delta round-trips", () => {
    const delta = { cx: 1, cy: 2, fromVersion: 9, toVersion: 10, cells: [{ index: 0, colorId: 5 }, { index: 65_535, colorId: 31 }] };
    expect(decodeChunkDelta(encodeChunkDelta(delta))).toEqual(delta);
  });

  test("chunk delta decoding rejects foreign frames", () => {
    expect(decodeChunkDelta(new Uint8Array([2, 0, 0]))).toBeNull();
  });

  test("chunk body round-trips", () => {
    const colors = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    colors[123] = 7;
    const decoded = decodeChunkBody(encodeChunkBody(42, colors));
    expect(decoded?.version).toBe(42);
    expect(decoded?.colors[123]).toBe(7);
    expect(decodeChunkBody(new Uint8Array(10))).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test packages/shared/src/protocol.test.ts`
Expected: FAIL — `Cannot find module './protocol'`.

- [ ] **Step 3: Реализовать**

`packages/shared/src/protocol.ts`:
```ts
import { CHUNK_SIZE } from "./constants";
import type { GameConfig, ItemKey } from "./config/schema";

export const PROTOCOL_VERSION = 1;
export const MAX_SUBSCRIBED_CHUNKS = 64;

// ---- Client → server: binary frames (little-endian) ----

export const ClientOp = { Subscribe: 1, Place: 2 } as const;

export interface SubscribeMessage {
  op: typeof ClientOp.Subscribe;
  /** Replaces the whole subscription set. */
  chunks: Array<{ cx: number; cy: number }>;
}

export interface PlaceMessage {
  op: typeof ClientOp.Place;
  reqId: number;
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
}

export type ClientMessage = SubscribeMessage | PlaceMessage;

// op u8 | reqId u32 | x u32 | y u32 | colorId u8 | flags u8
const PLACE_SIZE = 15;

export function encodeSubscribe(chunks: Array<{ cx: number; cy: number }>): Uint8Array {
  const bytes = new Uint8Array(3 + chunks.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ClientOp.Subscribe);
  view.setUint16(1, chunks.length, true);
  chunks.forEach((c, i) => {
    view.setUint16(3 + i * 4, c.cx, true);
    view.setUint16(5 + i * 4, c.cy, true);
  });
  return bytes;
}

export function encodePlace(m: Omit<PlaceMessage, "op">): Uint8Array {
  const bytes = new Uint8Array(PLACE_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ClientOp.Place);
  view.setUint32(1, m.reqId, true);
  view.setUint32(5, m.x, true);
  view.setUint32(9, m.y, true);
  view.setUint8(13, m.colorId);
  view.setUint8(14, m.withBomb ? 1 : 0);
  return bytes;
}

/** Parses a client frame; returns null for anything malformed. Never throws. */
export function decodeClientMessage(bytes: Uint8Array): ClientMessage | null {
  if (bytes.byteLength < 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const op = view.getUint8(0);
  if (op === ClientOp.Subscribe) {
    if (bytes.byteLength < 3) return null;
    const count = view.getUint16(1, true);
    if (count > MAX_SUBSCRIBED_CHUNKS || bytes.byteLength !== 3 + count * 4) return null;
    const chunks: Array<{ cx: number; cy: number }> = [];
    for (let i = 0; i < count; i++) {
      chunks.push({ cx: view.getUint16(3 + i * 4, true), cy: view.getUint16(5 + i * 4, true) });
    }
    return { op: ClientOp.Subscribe, chunks };
  }
  if (op === ClientOp.Place) {
    if (bytes.byteLength !== PLACE_SIZE) return null;
    const flags = view.getUint8(14);
    if (flags > 1) return null;
    return {
      op: ClientOp.Place,
      reqId: view.getUint32(1, true),
      x: view.getUint32(5, true),
      y: view.getUint32(9, true),
      colorId: view.getUint8(13),
      withBomb: flags === 1,
    };
  }
  return null;
}

// ---- Server → client: binary chunk delta ----

export const ServerOp = { ChunkDelta: 1 } as const;

/** Absolute new colors of changed cells; `index` is row-major inside the chunk. */
export interface ChunkDelta {
  cx: number;
  cy: number;
  fromVersion: number;
  toVersion: number;
  cells: Array<{ index: number; colorId: number }>;
}

// op u8 | cx u16 | cy u16 | from u32 | to u32 | count u32 | count × (index u16, colorId u8)
const DELTA_HEADER = 17;

export function encodeChunkDelta(d: ChunkDelta): Uint8Array {
  const bytes = new Uint8Array(DELTA_HEADER + d.cells.length * 3);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ServerOp.ChunkDelta);
  view.setUint16(1, d.cx, true);
  view.setUint16(3, d.cy, true);
  view.setUint32(5, d.fromVersion, true);
  view.setUint32(9, d.toVersion, true);
  view.setUint32(13, d.cells.length, true);
  d.cells.forEach((cell, i) => {
    view.setUint16(DELTA_HEADER + i * 3, cell.index, true);
    view.setUint8(DELTA_HEADER + i * 3 + 2, cell.colorId);
  });
  return bytes;
}

export function decodeChunkDelta(bytes: Uint8Array): ChunkDelta | null {
  if (bytes.byteLength < DELTA_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== ServerOp.ChunkDelta) return null;
  const count = view.getUint32(13, true);
  if (bytes.byteLength !== DELTA_HEADER + count * 3) return null;
  const cells: ChunkDelta["cells"] = [];
  for (let i = 0; i < count; i++) {
    cells.push({ index: view.getUint16(DELTA_HEADER + i * 3, true), colorId: view.getUint8(DELTA_HEADER + i * 3 + 2) });
  }
  return {
    cx: view.getUint16(1, true),
    cy: view.getUint16(3, true),
    fromVersion: view.getUint32(5, true),
    toVersion: view.getUint32(9, true),
    cells,
  };
}

// ---- HTTP chunk body: version u32 | colors (CHUNK_SIZE²) ----

export function encodeChunkBody(version: number, colors: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(4 + colors.byteLength);
  new DataView(bytes.buffer).setUint32(0, version, true);
  bytes.set(colors, 4);
  return bytes;
}

export function decodeChunkBody(bytes: Uint8Array): { version: number; colors: Uint8Array } | null {
  if (bytes.byteLength !== 4 + CHUNK_SIZE * CHUNK_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { version: view.getUint32(0, true), colors: bytes.slice(4) };
}

// ---- Server → client: JSON text messages ----

export interface UserRef {
  id: number;
  name: string;
}

export interface PlayerView {
  coins: number;
  /** Settled at the time the view was built; the client regenerates locally from here. */
  charges: number;
  chargesUpdatedAt: number;
  chargeCap: number;
  frozenUntil: number;
  inventory: Record<ItemKey, number>;
  unlockedColors: number[];
  dailyStep: number;
  dailyLastClaim: string | null;
  bannedUntil: number | "permanent" | null;
}

export type PlaceResultView =
  | { ok: true; outcome: "placed" }
  | { ok: true; outcome: "exploded"; self: boolean; frozenUntil: number; coinsLost: number; bombOwner: UserRef }
  | { ok: false; code: string };

export type ServerMessage =
  | { type: "hello"; protocol: number; user: UserRef | null; config: GameConfig; player: PlayerView | null }
  | { type: "player"; player: PlayerView }
  | { type: "placed"; reqId: number; result: PlaceResultView }
  | { type: "feed"; kind: "exploded" | "defused"; actor: UserRef; owner: UserRef; at: number }
  | { type: "online"; count: number };
```

`packages/shared/src/index.ts` — добавить строку:
```ts
export * from "./protocol";
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test packages/shared/src/protocol.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add websocket and chunk protocol"
```

---

### Task 4: Сессии и пользователи

**Files:**
- Create: `apps/server/src/auth/session.ts`, `apps/server/src/auth/users.ts`
- Test: `apps/server/src/auth/session.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/auth/session.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "../db/test-db";
import { T0 } from "../engine/test-utils";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  resolveSession,
  SESSION_COOKIE,
  sessionCookie,
} from "./session";
import { upsertUser } from "./users";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

const DAY = 86_400_000;
const alice = () => upsertUser(t.db, { discordId: "dev:alice", username: "alice", avatar: null, discordCreatedAt: new Date(Date.UTC(2015, 0, 1)) });

describe("upsertUser", () => {
  test("is idempotent by discord id and refreshes the name", async () => {
    const id = await alice();
    const again = await upsertUser(t.db, { discordId: "dev:alice", username: "alice2", avatar: "abc", discordCreatedAt: new Date(Date.UTC(2015, 0, 1)) });
    expect(again).toBe(id);
  });
});

describe("sessions", () => {
  test("a fresh session resolves to its user", async () => {
    const id = await alice();
    const { token, expiresAt } = await createSession(t.db, id, 30 * DAY, T0);
    expect(expiresAt.getTime()).toBe(T0 + 30 * DAY);
    expect(await resolveSession(t.db, token, T0)).toEqual({
      id,
      username: "alice",
      discordCreatedAt: Date.UTC(2015, 0, 1),
      bannedUntil: null,
    });
  });

  test("expired, unknown and deleted tokens resolve to null", async () => {
    const id = await alice();
    const { token } = await createSession(t.db, id, DAY, T0);
    expect(await resolveSession(t.db, token, T0 + DAY)).toBeNull();
    expect(await resolveSession(t.db, "nope", T0)).toBeNull();
    const fresh = await createSession(t.db, id, DAY, T0);
    await deleteSession(t.db, fresh.token);
    expect(await resolveSession(t.db, fresh.token, T0)).toBeNull();
  });

  test("tokens are random and only their hash is stored", async () => {
    const id = await alice();
    const a = await createSession(t.db, id, DAY, T0);
    const b = await createSession(t.db, id, DAY, T0);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    const rows = await t.db.query.sessions.findMany();
    expect(rows.map((r) => r.id)).not.toContain(a.token);
  });
});

describe("cookies", () => {
  test("reads the session token from the Cookie header", () => {
    const req = new Request("http://x/", { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok-en; b=2` } });
    expect(readSessionToken(req)).toBe("tok-en");
    expect(readSessionToken(new Request("http://x/"))).toBeNull();
  });

  test("builds hardened Set-Cookie values", () => {
    const value = sessionCookie("tok", new Date(T0), true);
    expect(value).toStartWith(`${SESSION_COOKIE}=tok; `);
    for (const part of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) expect(value).toContain(part);
    expect(sessionCookie("tok", new Date(T0), false)).not.toContain("Secure");
    expect(clearSessionCookie(false)).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/auth/session.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать**

`apps/server/src/auth/users.ts`:
```ts
import type { Db } from "../db/client";
import { users } from "../db/schema";

export interface UserProfile {
  discordId: string;
  username: string;
  avatar: string | null;
  discordCreatedAt: Date;
}

/** Creates or refreshes a user by Discord id; returns the internal id. */
export async function upsertUser(db: Db, profile: UserProfile): Promise<number> {
  const [row] = await db
    .insert(users)
    .values(profile)
    .onConflictDoUpdate({
      target: users.discordId,
      set: { username: profile.username, avatar: profile.avatar, lastSeenAt: new Date() },
    })
    .returning({ id: users.id });
  return row!.id;
}
```

`apps/server/src/auth/session.ts`:
```ts
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { banFromDate } from "../persistence/codec";

export const SESSION_COOKIE = "rb_session";

export interface SessionUser {
  id: number;
  username: string;
  discordCreatedAt: number;
  /** Epoch ms, Infinity for permanent, null when not banned. */
  bannedUntil: number | null;
}

const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

export async function createSession(
  db: Db,
  userId: number,
  ttlMs: number,
  now: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expiresAt = new Date(now + ttlMs);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string, now: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      discordCreatedAt: users.discordCreatedAt,
      bannedUntil: users.bannedUntil,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date(now))))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    discordCreatedAt: row.discordCreatedAt.getTime(),
    bannedUntil: banFromDate(row.bannedUntil),
  };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Expires=${expiresAt.toUTCString()}`]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/auth/session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck и commit**

Run: `bun run typecheck`
Expected: exit 0.

```bash
git add apps/server/src/auth
git commit -m "feat(auth): add cookie sessions and user upsert"
```

---

### Task 5: `TokenBucket`, окружение, справочник имён

**Files:**
- Create: `apps/server/src/net/rate-limit.ts`, `apps/server/src/net/env.ts`, `apps/server/src/net/user-directory.ts`
- Test: `apps/server/src/net/rate-limit.test.ts`, `apps/server/src/net/env.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/net/rate-limit.test.ts`:
```ts
import { expect, test } from "bun:test";
import { TokenBucket } from "./rate-limit";

test("allows a burst up to capacity, then refills over time", () => {
  const bucket = new TokenBucket(3, 2, 0);
  expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
  expect(bucket.take(499)).toBe(false);
  expect(bucket.take(500)).toBe(true);
});

test("never stores more than capacity", () => {
  const bucket = new TokenBucket(2, 10, 0);
  expect([bucket.take(60_000), bucket.take(60_000), bucket.take(60_000)]).toEqual([true, true, false]);
});
```

`apps/server/src/net/env.test.ts`:
```ts
import { expect, test } from "bun:test";
import { loadEnv } from "./env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", PUBLIC_URL: "http://localhost:5173" };

test("defaults and derived values", () => {
  const cfg = loadEnv(base);
  expect(cfg.port).toBe(3000);
  expect(cfg.devLogin).toBe(false);
  expect(cfg.secureCookies).toBe(false);
  expect(cfg.sessionTtlMs).toBe(30 * 86_400_000);
  expect([...cfg.allowedOrigins]).toEqual(["http://localhost:5173"]);
});

test("extra origins are added and https enables secure cookies", () => {
  const cfg = loadEnv({ ...base, PUBLIC_URL: "https://rave.example/app", ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173" });
  expect(cfg.secureCookies).toBe(true);
  expect([...cfg.allowedOrigins].sort()).toEqual(["http://127.0.0.1:5173", "http://localhost:5173", "https://rave.example"]);
});

test("dev login is refused in production", () => {
  expect(() => loadEnv({ ...base, DEV_LOGIN: "1", NODE_ENV: "production" })).toThrow();
  expect(loadEnv({ ...base, DEV_LOGIN: "1" }).devLogin).toBe(true);
});

test("missing required variables fail fast", () => {
  expect(() => loadEnv({ PUBLIC_URL: base.PUBLIC_URL })).toThrow();
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `bun test apps/server/src/net`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать**

`apps/server/src/net/rate-limit.ts`:
```ts
/** Classic token bucket; time comes from the caller. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updatedAt) / 1000) * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
```

`apps/server/src/net/env.ts`:
```ts
import { DAY_MS } from "@rave/shared";
import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    PUBLIC_URL: z.url(),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    ALLOWED_ORIGINS: z.string().default(""),
    DEV_LOGIN: z.enum(["0", "1"]).default("0"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  })
  .refine((env) => !(env.DEV_LOGIN === "1" && env.NODE_ENV === "production"), {
    message: "DEV_LOGIN must be disabled in production",
    path: ["DEV_LOGIN"],
  });

export interface ServerConfig {
  databaseUrl: string;
  port: number;
  publicOrigin: string;
  /** Origins allowed to open the WebSocket (cookie-authenticated, so this blocks cross-site hijacking). */
  allowedOrigins: Set<string>;
  devLogin: boolean;
  secureCookies: boolean;
  sessionTtlMs: number;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerConfig {
  const env = envSchema.parse(source);
  const publicUrl = new URL(env.PUBLIC_URL);
  const extra = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  return {
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    publicOrigin: publicUrl.origin,
    allowedOrigins: new Set([publicUrl.origin, ...extra]),
    devLogin: env.DEV_LOGIN === "1",
    secureCookies: publicUrl.protocol === "https:",
    sessionTtlMs: env.SESSION_TTL_DAYS * DAY_MS,
  };
}
```

`apps/server/src/net/user-directory.ts`:
```ts
import type { UserRef } from "@rave/shared";
import type { Db } from "../db/client";
import { users } from "../db/schema";

/** In-memory id → display name, for feed and explosion messages. */
export class UserDirectory {
  private names = new Map<number, string>();

  static async load(db: Db): Promise<UserDirectory> {
    const dir = new UserDirectory();
    for (const u of await db.select({ id: users.id, username: users.username }).from(users)) dir.set(u.id, u.username);
    return dir;
  }

  set(id: number, name: string): void {
    this.names.set(id, name);
  }

  ref(id: number): UserRef {
    return { id, name: this.names.get(id) ?? `#${id}` };
  }
}
```

`zod` нужен серверу напрямую — установить до запуска тестов:
```bash
bun add zod@4.6.5 --cwd apps/server
```

- [ ] **Step 4: Запустить, убедиться что проходят**

Run: `bun test apps/server/src/net`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck и commit**

Run: `bun run typecheck`
Expected: exit 0.

```bash
git add apps/server bun.lock
git commit -m "feat(server): add rate limiter, env config and user directory"
```

---

### Task 6: Представления для клиента (`views.ts`)

**Files:**
- Create: `apps/server/src/net/views.ts`
- Test: `apps/server/src/net/views.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/net/views.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { makeEngine, T0 } from "../engine/test-utils";
import type { EngineEvent } from "../engine/types";
import { UserDirectory } from "./user-directory";
import { buildChunkDeltas, buildFeed, ChunkVersions, toPlaceResultView, toPlayerView } from "./views";

const directory = () => {
  const users = new UserDirectory();
  users.set(1, "alice");
  users.set(2, "bob");
  return users;
};

describe("toPlayerView", () => {
  test("settles charges on a copy and never mutates the engine state", () => {
    const { cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.charges = 0;
    p.chargesUpdatedAt = T0;
    const view = toPlayerView(p, cfg, T0 + 65_000);
    expect(view.charges).toBe(2);
    expect(view.chargeCap).toBe(10);
    expect(p.charges).toBe(0);
    expect(p.chargesUpdatedAt).toBe(T0);
  });

  test("maps a permanent ban and sorts unlocked colors", () => {
    const { cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.bannedUntil = Number.POSITIVE_INFINITY;
    p.unlockedColors = new Set([40, 33]);
    const view = toPlayerView(p, cfg, T0);
    expect(view.bannedUntil).toBe("permanent");
    expect(view.unlockedColors).toEqual([33, 40]);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("toPlaceResultView", () => {
  test("replaces the bomb owner id with a user ref", () => {
    const view = toPlaceResultView(
      { ok: true, outcome: "exploded", self: false, frozenUntil: T0, coinsLost: 10, bombOwnerId: 1 },
      directory(),
    );
    expect(view).toEqual({ ok: true, outcome: "exploded", self: false, frozenUntil: T0, coinsLost: 10, bombOwner: { id: 1, name: "alice" } });
  });
});

describe("buildChunkDeltas", () => {
  const pixel = (x: number, y: number, colorId: number): EngineEvent => ({
    type: "pixel", x, y, userId: 1, colorId, prevColorId: 0, prevUserId: 0, at: T0,
  });

  test("groups pixels by chunk, keeps the last color per cell and bumps versions", () => {
    const versions = new ChunkVersions();
    const deltas = buildChunkDeltas([pixel(1, 1, 3), pixel(1, 1, 4), pixel(300, 2, 5), { type: "player", userId: 1 }], versions);
    expect(deltas).toEqual([
      { cx: 0, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 257, colorId: 4 }] },
      { cx: 1, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 2 * 256 + 44, colorId: 5 }] },
    ]);
    expect(buildChunkDeltas([pixel(2, 1, 6)], versions)[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(versions.get(0, 0)).toBe(2);
  });
});

describe("buildFeed", () => {
  test("announces explosions and defuses without coordinates", () => {
    const events: EngineEvent[] = [
      { type: "bomb_removed", x: 5, y: 5, ownerId: 1, reason: "exploded", removedBy: 2, at: T0 },
      { type: "bomb_removed", x: 6, y: 6, ownerId: 2, reason: "defused", removedBy: 1, at: T0 + 1 },
    ];
    const feed = buildFeed(events, directory());
    expect(feed).toEqual([
      { type: "feed", kind: "exploded", actor: { id: 2, name: "bob" }, owner: { id: 1, name: "alice" }, at: T0 },
      { type: "feed", kind: "defused", actor: { id: 1, name: "alice" }, owner: { id: 2, name: "bob" }, at: T0 + 1 },
    ]);
    for (const message of feed) expect(Object.keys(message).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/net/views.test.ts`
Expected: FAIL — `Cannot find module './views'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/net/views.ts`:
```ts
import { CHUNK_SIZE, type ChunkDelta, type GameConfig, type PlaceResultView, type PlayerView, type ServerMessage } from "@rave/shared";
import { chargeCap, settleCharges } from "../engine/charges";
import type { EngineEvent, PlaceResult, PlayerState } from "../engine/types";
import type { UserDirectory } from "./user-directory";

export function toPlayerView(p: PlayerState, cfg: GameConfig, now: number): PlayerView {
  const settled = { ...p };
  settleCharges(settled, cfg, now);
  return {
    coins: p.coins,
    charges: settled.charges,
    chargesUpdatedAt: settled.chargesUpdatedAt,
    chargeCap: chargeCap(p, cfg),
    frozenUntil: p.frozenUntil,
    inventory: { ...p.inventory },
    unlockedColors: [...p.unlockedColors].sort((a, b) => a - b),
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
    bannedUntil: p.bannedUntil === null ? null : Number.isFinite(p.bannedUntil) ? p.bannedUntil : "permanent",
  };
}

export function toPlaceResultView(result: PlaceResult, users: UserDirectory): PlaceResultView {
  if (!result.ok) return { ok: false, code: result.code };
  if (result.outcome === "placed") return { ok: true, outcome: "placed" };
  return {
    ok: true,
    outcome: "exploded",
    self: result.self,
    frozenUntil: result.frozenUntil,
    coinsLost: result.coinsLost,
    bombOwner: users.ref(result.bombOwnerId),
  };
}

/** Per-chunk counter of broadcast deltas since server start. */
export class ChunkVersions {
  private versions = new Map<string, number>();

  get(cx: number, cy: number): number {
    return this.versions.get(`${cx}:${cy}`) ?? 0;
  }

  bump(cx: number, cy: number): { fromVersion: number; toVersion: number } {
    const fromVersion = this.get(cx, cy);
    this.versions.set(`${cx}:${cy}`, fromVersion + 1);
    return { fromVersion, toVersion: fromVersion + 1 };
  }
}

export function buildChunkDeltas(events: EngineEvent[], versions: ChunkVersions): ChunkDelta[] {
  const byChunk = new Map<string, { cx: number; cy: number; cells: Map<number, number> }>();
  for (const e of events) {
    if (e.type !== "pixel") continue;
    const cx = Math.floor(e.x / CHUNK_SIZE);
    const cy = Math.floor(e.y / CHUNK_SIZE);
    const key = `${cx}:${cy}`;
    const entry = byChunk.get(key) ?? { cx, cy, cells: new Map<number, number>() };
    entry.cells.set((e.y % CHUNK_SIZE) * CHUNK_SIZE + (e.x % CHUNK_SIZE), e.colorId);
    byChunk.set(key, entry);
  }
  return [...byChunk.values()].map(({ cx, cy, cells }) => ({
    cx,
    cy,
    ...versions.bump(cx, cy),
    cells: [...cells].map(([index, colorId]) => ({ index, colorId })),
  }));
}

type FeedMessage = Extract<ServerMessage, { type: "feed" }>;

/** Feed entries carry who and whose bomb — never where. */
export function buildFeed(events: EngineEvent[], users: UserDirectory): FeedMessage[] {
  const feed: FeedMessage[] = [];
  for (const e of events) {
    if (e.type !== "bomb_removed") continue;
    feed.push({ type: "feed", kind: e.reason, actor: users.ref(e.removedBy), owner: users.ref(e.ownerId), at: e.at });
  }
  return feed;
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/net/views.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck и commit**

Run: `bun run typecheck`
Expected: exit 0.

```bash
git add apps/server/src/net
git commit -m "feat(server): add client views, chunk deltas and feed"
```

---

### Task 7: `Hub` и HTTP/WS-сервер

**Files:**
- Create: `apps/server/src/net/hub.ts`, `apps/server/src/net/server.ts`
- Test: `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Написать падающие интеграционные тесты**

`apps/server/src/net/server.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CHUNK_SIZE,
  decodeChunkBody,
  decodeChunkDelta,
  encodePlace,
  encodeSubscribe,
  type ChunkDelta,
  type ServerMessage,
} from "@rave/shared";
import type { Server } from "bun";
import { createTestDb } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import { Hub, type HubOptions, type SocketData } from "./hub";
import { startServer } from "./server";
import { UserDirectory } from "./user-directory";

const ORIGIN = "http://localhost:5173";
const t = createTestDb();

let runtime: GameRuntime;
let hub: Hub;
let server: Server<SocketData>;
let base = "";
const sockets: WebSocket[] = [];

async function start(options: { devLogin?: boolean; hub?: Partial<HubOptions> } = {}) {
  await t.reset();
  const users = await UserDirectory.load(t.db);
  let hubRef: Hub | undefined;
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {}, onCommit: (events) => hubRef?.handleCommit(events) });
  hub = new Hub({ runtime, users, onlineDebounceMs: 10, ...options.hub });
  hubRef = hub;
  const config: ServerConfig = {
    databaseUrl: "",
    port: 0,
    publicOrigin: ORIGIN,
    allowedOrigins: new Set([ORIGIN]),
    devLogin: options.devLogin ?? true,
    secureCookies: false,
    sessionTtlMs: 86_400_000,
  };
  server = startServer({ db: t.db, runtime, hub, users, config });
  base = `http://localhost:${server.port}`;
}

beforeEach(() => start());
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server.stop(true);
  hub.stop();
  await runtime.stop().catch(() => {});
});

async function login(name: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev?name=${name}`, { redirect: "manual" });
  expect(res.status).toBe(302);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

interface Client {
  ws: WebSocket;
  json: ServerMessage[];
  deltas: ChunkDelta[];
  closed: Promise<number>;
}

function connect(cookie?: string): Promise<Client> {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  ws.binaryType = "arraybuffer";
  sockets.push(ws);
  const client: Client = { ws, json: [], deltas: [], closed: new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e.code))) };
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") client.json.push(JSON.parse(e.data));
    else client.deltas.push(decodeChunkDelta(new Uint8Array(e.data as ArrayBuffer))!);
  });
  return waitFor(() => client.json.find((m) => m.type === "hello")).then(() => client);
}

async function waitFor<T>(probe: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

const hello = (c: Client) => c.json.find((m): m is Extract<ServerMessage, { type: "hello" }> => m.type === "hello")!;

const placed = (c: Client, reqId: number) =>
  waitFor(() => c.json.find((m): m is Extract<ServerMessage, { type: "placed" }> => m.type === "placed" && m.reqId === reqId));

describe("http", () => {
  test("health", async () => {
    expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
  });

  test("chunk endpoint returns version and colors; out-of-range is 404", async () => {
    const alice = await connect(await login("alice"));
    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: false }));
    await placed(alice, 1);
    const res = await fetch(`${base}/chunk/0/0`);
    const body = decodeChunkBody(new Uint8Array(await res.arrayBuffer()))!;
    expect(body.version).toBe(1);
    expect(body.colors[4 * CHUNK_SIZE + 3]).toBe(5);
    expect((await fetch(`${base}/chunk/2/0`)).status).toBe(404);
  });

  test("dev login is 404 when disabled", async () => {
    await server.stop(true);
    hub.stop();
    await runtime.stop();
    await start({ devLogin: false });
    expect((await fetch(`${base}/auth/dev?name=x`, { redirect: "manual" })).status).toBe(404);
  });

  test("websocket upgrades from foreign origins are refused", async () => {
    const res = await fetch(`${base}/ws`, {
      headers: { Origin: "http://evil.test", Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" },
    });
    expect(res.status).toBe(403);
  });
});

describe("websocket", () => {
  test("anonymous viewers get config but cannot place", async () => {
    const viewer = await connect();
    expect(hello(viewer).user).toBeNull();
    expect(hello(viewer).player).toBeNull();
    expect(hello(viewer).config.canvas.width).toBe(512);
    viewer.ws.send(encodePlace({ reqId: 9, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(viewer, 9)).result).toEqual({ ok: false, code: "unauthorized" });
  });

  test("a placed pixel is acknowledged, broadcast to chunk subscribers and updates the player", async () => {
    const alice = await connect(await login("alice"));
    expect(hello(alice).user?.name).toBe("alice");
    expect(hello(alice).player?.coins).toBe(100);

    const viewer = await connect();
    viewer.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    await Bun.sleep(20);

    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: false }));
    expect((await placed(alice, 1)).result).toEqual({ ok: true, outcome: "placed" });
    const delta = await waitFor(() => viewer.deltas[0]);
    expect(delta).toEqual({ cx: 0, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 4 * CHUNK_SIZE + 3, colorId: 5 }] });
    const update = await waitFor(() => alice.json.find((m): m is Extract<ServerMessage, { type: "player" }> => m.type === "player"));
    expect(update.player.coins).toBe(101);
  });

  test("bombs never leak: explosions produce a feed entry without coordinates and no chunk delta", async () => {
    const alice = await connect(await login("alice"));
    const bob = await connect(await login("bob"));
    const viewer = await connect();
    viewer.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    await Bun.sleep(20);

    alice.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(alice, 1);
    const armed = await waitFor(() => viewer.deltas[0]);
    expect(armed.cells).toEqual([{ index: 5 * CHUNK_SIZE + 5, colorId: 3 }]);

    bob.ws.send(encodePlace({ reqId: 2, x: 5, y: 5, colorId: 9, withBomb: false }));
    const boom = await placed(bob, 2);
    expect(boom.result).toMatchObject({ ok: true, outcome: "exploded", self: false, bombOwner: { name: "alice" } });

    const feed = await waitFor(() => viewer.json.find((m) => m.type === "feed"));
    expect(Object.keys(feed).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);

    alice.ws.send(encodePlace({ reqId: 3, x: 6, y: 6, colorId: 4, withBomb: false }));
    await placed(alice, 3);
    const next = await waitFor(() => viewer.deltas[1]);
    expect(next).toEqual({ cx: 0, cy: 0, fromVersion: 1, toVersion: 2, cells: [{ index: 6 * CHUNK_SIZE + 6, colorId: 4 }] });
    expect(viewer.deltas).toHaveLength(2);
  });

  test("malformed and text frames close the socket with 1003", async () => {
    const a = await connect();
    a.ws.send(new Uint8Array([99]));
    expect(await a.closed).toBe(1003);
    const b = await connect();
    b.ws.send("hello");
    expect(await b.closed).toBe(1003);
  });

  test("flooding closes the socket with 1008", async () => {
    await server.stop(true);
    hub.stop();
    await runtime.stop();
    await start({ hub: { messageRate: { capacity: 3, perSecond: 0.001 } } });
    const c = await connect();
    for (let i = 0; i < 5; i++) c.ws.send(encodeSubscribe([]));
    expect(await c.closed).toBe(1008);
  });

  test("logout clears the session", async () => {
    const cookie = await login("alice");
    const res = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await connect(cookie);
    expect(hello(after).user).toBeNull();
  });

  test("online count is broadcast", async () => {
    const a = await connect();
    await connect();
    const online = await waitFor(() => a.json.find((m) => m.type === "online" && m.count === 2));
    expect(online).toEqual({ type: "online", count: 2 });
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/net/server.test.ts`
Expected: FAIL — `Cannot find module './hub'`.

- [ ] **Step 3: Реализовать `hub.ts`**

`apps/server/src/net/hub.ts`:
```ts
import {
  CHUNK_SIZE,
  ClientOp,
  decodeClientMessage,
  encodeChunkDelta,
  PROTOCOL_VERSION,
  type PlaceMessage,
  type PlayerView,
  type ServerMessage,
} from "@rave/shared";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { SessionUser } from "../auth/session";
import type { EngineEvent } from "../engine/types";
import type { GameRuntime } from "../persistence/runtime";
import { TokenBucket } from "./rate-limit";
import type { UserDirectory } from "./user-directory";
import { buildChunkDeltas, buildFeed, ChunkVersions, toPlaceResultView, toPlayerView } from "./views";

export const GLOBAL_TOPIC = "global";
const chunkTopic = (key: string) => `chunk:${key}`;
const userTopic = (userId: number) => `user:${userId}`;

export interface SocketData {
  user: SessionUser | null;
  ip: string;
  chunks: Set<string>;
  bucket: TokenBucket;
}

export interface HubOptions {
  runtime: GameRuntime;
  users: UserDirectory;
  now?: () => number;
  messageRate?: { capacity: number; perSecond: number };
  maxConnectionsPerIp?: number;
  onlineDebounceMs?: number;
}

type Socket = ServerWebSocket<SocketData>;

const send = (ws: Socket, message: ServerMessage) => ws.send(JSON.stringify(message));

/** WebSocket handling plus broadcasting of committed engine events. */
export class Hub {
  readonly versions = new ChunkVersions();
  private server: Server<SocketData> | null = null;
  private connectionsByIp = new Map<string, number>();
  private onlineTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly messageRate: { capacity: number; perSecond: number };
  private readonly maxConnectionsPerIp: number;
  private readonly onlineDebounceMs: number;

  constructor(private readonly options: HubOptions) {
    this.now = options.now ?? Date.now;
    this.messageRate = options.messageRate ?? { capacity: 40, perSecond: 20 };
    this.maxConnectionsPerIp = options.maxConnectionsPerIp ?? 10;
    this.onlineDebounceMs = options.onlineDebounceMs ?? 1000;
  }

  attach(server: Server<SocketData>): void {
    this.server = server;
  }

  stop(): void {
    if (this.onlineTimer) clearTimeout(this.onlineTimer);
    this.onlineTimer = null;
  }

  canConnect(ip: string): boolean {
    return (this.connectionsByIp.get(ip) ?? 0) < this.maxConnectionsPerIp;
  }

  socketData(user: SessionUser | null, ip: string): SocketData {
    const { capacity, perSecond } = this.messageRate;
    return { user, ip, chunks: new Set(), bucket: new TokenBucket(capacity, perSecond, this.now()) };
  }

  /** `GameRuntime` onCommit hook: clients only ever see committed state. */
  handleCommit(events: EngineEvent[]): void {
    const server = this.server;
    if (!server) return;
    for (const delta of buildChunkDeltas(events, this.versions)) {
      server.publish(chunkTopic(`${delta.cx}:${delta.cy}`), encodeChunkDelta(delta));
    }
    for (const entry of buildFeed(events, this.options.users)) server.publish(GLOBAL_TOPIC, JSON.stringify(entry));
    const touched = new Set<number>();
    for (const e of events) if (e.type === "player") touched.add(e.userId);
    for (const userId of touched) {
      server.publish(userTopic(userId), JSON.stringify({ type: "player", player: this.playerView(userId) } satisfies ServerMessage));
    }
  }

  readonly websocket: WebSocketHandler<SocketData> = {
    data: {} as SocketData,
    open: (ws) => this.open(ws),
    message: (ws, message) => this.message(ws, message),
    close: (ws) => this.close(ws),
  };

  private playerView(userId: number): PlayerView {
    const engine = this.options.runtime.engine;
    return toPlayerView(engine.players.get(userId), engine.config, this.now());
  }

  private async open(ws: Socket): Promise<void> {
    const { user, ip } = ws.data;
    this.connectionsByIp.set(ip, (this.connectionsByIp.get(ip) ?? 0) + 1);
    ws.subscribe(GLOBAL_TOPIC);
    this.scheduleOnline();

    let player: PlayerView | null = null;
    if (user) {
      ws.subscribe(userTopic(user.id));
      try {
        // Guild membership is checked at Discord login (Plan 2c); dev users are always members.
        await this.options.runtime.addPlayer({ userId: user.id, accountCreatedAt: user.discordCreatedAt, guildMember: true });
        player = this.playerView(user.id);
      } catch {
        ws.close(1011, "unavailable");
        return;
      }
    }
    send(ws, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      user: user ? this.options.users.ref(user.id) : null,
      config: this.options.runtime.engine.config,
      player,
    });
  }

  private async message(ws: Socket, message: string | Buffer): Promise<void> {
    if (!ws.data.bucket.take(this.now())) {
      ws.close(1008, "rate limited");
      return;
    }
    if (typeof message === "string") {
      ws.close(1003, "binary frames only");
      return;
    }
    const msg = decodeClientMessage(message);
    if (!msg) {
      ws.close(1003, "malformed frame");
      return;
    }
    if (msg.op === ClientOp.Subscribe) this.subscribe(ws, msg.chunks);
    else await this.place(ws, msg);
  }

  private subscribe(ws: Socket, chunks: Array<{ cx: number; cy: number }>): void {
    const canvas = this.options.runtime.engine.canvas;
    const next = new Set(
      chunks
        .filter((c) => c.cx * CHUNK_SIZE < canvas.width && c.cy * CHUNK_SIZE < canvas.height)
        .map((c) => `${c.cx}:${c.cy}`),
    );
    for (const key of ws.data.chunks) if (!next.has(key)) ws.unsubscribe(chunkTopic(key));
    for (const key of next) if (!ws.data.chunks.has(key)) ws.subscribe(chunkTopic(key));
    ws.data.chunks = next;
  }

  private async place(ws: Socket, msg: PlaceMessage): Promise<void> {
    const user = ws.data.user;
    if (!user) {
      send(ws, { type: "placed", reqId: msg.reqId, result: { ok: false, code: "unauthorized" } });
      return;
    }
    try {
      const result = await this.options.runtime.run((engine, now) =>
        engine.placePixel(user.id, { x: msg.x, y: msg.y, colorId: msg.colorId, withBomb: msg.withBomb }, now),
      );
      send(ws, { type: "placed", reqId: msg.reqId, result: toPlaceResultView(result, this.options.users) });
    } catch {
      send(ws, { type: "placed", reqId: msg.reqId, result: { ok: false, code: "unavailable" } });
    }
  }

  private close(ws: Socket): void {
    const left = (this.connectionsByIp.get(ws.data.ip) ?? 1) - 1;
    if (left <= 0) this.connectionsByIp.delete(ws.data.ip);
    else this.connectionsByIp.set(ws.data.ip, left);
    this.scheduleOnline();
  }

  private scheduleOnline(): void {
    if (this.onlineTimer) return;
    this.onlineTimer = setTimeout(() => {
      this.onlineTimer = null;
      const server = this.server;
      if (!server) return;
      const count = server.subscriberCount(GLOBAL_TOPIC);
      server.publish(GLOBAL_TOPIC, JSON.stringify({ type: "online", count } satisfies ServerMessage));
    }, this.onlineDebounceMs);
  }
}
```

- [ ] **Step 4: Реализовать `server.ts`**

`apps/server/src/net/server.ts`:
```ts
import { CHUNK_SIZE, encodeChunkBody } from "@rave/shared";
import type { Server } from "bun";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  resolveSession,
  sessionCookie,
} from "../auth/session";
import { upsertUser } from "../auth/users";
import type { Db } from "../db/client";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import type { Hub, SocketData } from "./hub";
import type { UserDirectory } from "./user-directory";

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Hub;
  users: UserDirectory;
  config: ServerConfig;
}

/** Dev accounts look old enough to pass the account-age check. */
const DEV_ACCOUNT_CREATED_AT = new Date(Date.UTC(2015, 0, 1));
const CHUNK_PATH = /^\/chunk\/(\d+)\/(\d+)$/;

export function startServer(deps: AppDeps): Server<SocketData> {
  const server = Bun.serve({
    port: deps.config.port,
    fetch: (req, srv) => route(req, srv, deps),
    websocket: deps.hub.websocket,
  });
  deps.hub.attach(server);
  return server;
}

async function route(req: Request, server: Server<SocketData>, deps: AppDeps): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname === "/ws") return upgrade(req, server, deps);
  if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
  const chunk = req.method === "GET" ? CHUNK_PATH.exec(url.pathname) : null;
  if (chunk) return chunkResponse(deps, Number(chunk[1]), Number(chunk[2]));
  if (req.method === "GET" && url.pathname === "/auth/dev" && deps.config.devLogin) return devLogin(url, deps);
  if (req.method === "POST" && url.pathname === "/auth/logout") return logout(req, deps);
  return new Response("Not found", { status: 404 });
}

async function upgrade(req: Request, server: Server<SocketData>, deps: AppDeps): Promise<Response | undefined> {
  const origin = req.headers.get("origin");
  if (!origin || !deps.config.allowedOrigins.has(origin)) return new Response("Forbidden origin", { status: 403 });
  const ip = server.requestIP(req)?.address ?? "unknown";
  if (!deps.hub.canConnect(ip)) return new Response("Too many connections", { status: 429 });
  const token = readSessionToken(req, deps.config.secureCookies);
  const user = token ? await resolveSession(deps.db, token, Date.now()) : null;
  if (server.upgrade(req, { data: deps.hub.socketData(user, ip) })) return undefined;
  return new Response("WebSocket upgrade required", { status: 426 });
}

function chunkResponse(deps: AppDeps, cx: number, cy: number): Response {
  const canvas = deps.runtime.engine.canvas;
  if (cx * CHUNK_SIZE >= canvas.width || cy * CHUNK_SIZE >= canvas.height) return new Response("Not found", { status: 404 });
  const colors = canvas.getChunk(cx, cy)?.colors ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const body = Bun.gzipSync(encodeChunkBody(deps.hub.versions.get(cx, cy), colors));
  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip", "Cache-Control": "no-store" },
  });
}

async function devLogin(url: URL, deps: AppDeps): Promise<Response> {
  const name = url.searchParams.get("name") ?? "";
  if (!/^[a-z0-9_]{1,32}$/i.test(name)) return new Response("Bad name", { status: 400 });
  const id = await upsertUser(deps.db, { discordId: `dev:${name}`, username: name, avatar: null, discordCreatedAt: DEV_ACCOUNT_CREATED_AT });
  deps.users.set(id, name);
  const { token, expiresAt } = await createSession(deps.db, id, deps.config.sessionTtlMs, Date.now());
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sessionCookie(token, expiresAt, deps.config.secureCookies) },
  });
}

async function logout(req: Request, deps: AppDeps): Promise<Response> {
  const token = readSessionToken(req, deps.config.secureCookies);
  if (token) await deleteSession(deps.db, token);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(deps.config.secureCookies) } });
}
```

- [ ] **Step 5: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/net/server.test.ts`
Expected: PASS, 11 tests.

Если тест падает из-за тайминга (например, дельта приходит до подписки), не увеличивать таймауты вслепую — разобраться в причине; `Bun.sleep(20)` после `encodeSubscribe` нужен потому, что подписка применяется асинхронно относительно клиента.

- [ ] **Step 6: Весь набор и typecheck**

Run: `bun test && bun run typecheck`
Expected: 0 fail; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/net
git commit -m "feat(server): add websocket hub and http routes"
```

---

### Task 8: Точка входа и запуск

**Files:**
- Create: `apps/server/src/main.ts`
- Modify: `.env.example`, `package.json` (корень)

- [ ] **Step 1: Создать `apps/server/src/main.ts`**

```ts
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { acquireWriterLock } from "./db/writer-lock";
import { loadEnv } from "./net/env";
import { Hub } from "./net/hub";
import { startServer } from "./net/server";
import { UserDirectory } from "./net/user-directory";
import { bootGame } from "./persistence/boot";

async function main(): Promise<void> {
  const config = loadEnv();
  const lock = await acquireWriterLock(config.databaseUrl, {
    onLost: () => {
      console.error("Fatal: lost the single-writer lock");
      process.exit(1);
    },
  });
  const { db, close } = createDb(config.databaseUrl);
  await runMigrations(db);

  const users = await UserDirectory.load(db);
  let hub: Hub | undefined;
  const runtime = await bootGame(db, { onCommit: (events) => hub?.handleCommit(events) });
  hub = new Hub({ runtime, users });
  const server = startServer({ db, runtime, hub, users, config });
  console.log(`Rave Battle server listening on :${server.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: shutting down`);
    // Stop accepting commands and persist everything before closing connections.
    await runtime.stop().catch((error) => console.error("Final commit failed", error));
    hub?.stop();
    // Bun 1.3.6: server.stop() never resolves once the server itself closed a websocket — don't wait forever.
    await Promise.race([server.stop(true), Bun.sleep(2000)]);
    await close();
    await lock.release().catch((error) => console.error("Lock release failed", error));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Дополнить `.env.example`**

Полное содержимое:
```
DATABASE_URL=postgres://rave:rave@localhost:54329/rave
TEST_DATABASE_URL=postgres://rave:rave@localhost:54329/rave_test
PORT=3000
PUBLIC_URL=http://localhost:5173
ALLOWED_ORIGINS=http://127.0.0.1:5173
DEV_LOGIN=1
NODE_ENV=development
```

- [ ] **Step 3: Скрипты в корневом `package.json`**

В секцию `scripts` добавить (корень — чтобы Bun подхватил корневой `.env`):
```json
    "dev:server": "bun --watch apps/server/src/main.ts",
    "start:server": "bun apps/server/src/main.ts",
```

- [ ] **Step 4: Smoke-проверка запуска, единственного писателя и shutdown**

Run:
```bash
cp -n .env.example .env
bun apps/server/src/main.ts > tmp/server1.log 2>&1 & S1=$!
sleep 2
curl -s localhost:3000/health; echo
PORT=3001 bun apps/server/src/main.ts > tmp/server2.log 2>&1; echo "second exit: $?"
kill -INT $S1; wait $S1; echo "first exit: $?"
cat tmp/server1.log; tail -1 tmp/server2.log
```
Expected (если порт 3000 занят — выставить другой `PORT` в `.env` и в `curl`):
- `ok`
- `second exit: 1`, `tmp/server2.log` содержит `Another server instance is already running`
- `first exit: 0`, лог первого содержит `listening on :3000` и `SIGINT: shutting down`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/main.ts .env.example package.json
git commit -m "feat(server): add entry point with graceful shutdown"
```

---

### Task 9: Финальная проверка

- [ ] **Step 1: Все тесты**

Run: `bun test`
Expected: 0 fail, **156** тестов: 101 + runtime 5 + lock 2 + boot 1 + protocol 7 + session 7 + rate-limit 3 + env 6 + views 5 + schema 1 + server 17 (включая тесты исправлений по ревью Task 2, 3–6 и 7).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Чистое дерево**

Run: `git status --short`
Expected: пустой вывод (`.env` и `tmp/` игнорируются).
