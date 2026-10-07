# План 2a: Персистентность — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игровое состояние `GameEngine` надёжно сохраняется в Postgres (group commit, fail-fast) и полностью восстанавливается при старте (снапшоты чанков + проигрывание лога, игроки, бомбы, анти-фарм, конфиг, сезон).

**Architecture:** `GameRuntime` оборачивает `GameEngine`: команда выполняется синхронно, её события копятся, раз в ~100 мс весь накопленный срез (события + снапшоты изменённых игроков + при необходимости копии чанков) пишется одной транзакцией функцией `writeBatch`; промис команды резолвится только после коммита. Ошибка коммита → все ожидающие команды получают reject, рантайм помечается сломанным и вызывает `onFatal` (по умолчанию — выход процесса). `loadGame` собирает новый `GameEngine` из БД.

**Tech Stack:** Bun 1.3, TypeScript 7, drizzle-orm 0.45.3 + drizzle-kit 0.31, postgres.js 3.4 (драйвер `drizzle-orm/postgres-js`), Postgres 17 в Docker, `bun test`.

**Спека:** `docs/superpowers/specs/2026-10-07-rave-battle-design.md` (разделы 3.3, 4). **Роадмап:** `docs/superpowers/plans/2026-10-07-00-roadmap.md` (включая «Заметки для Плана 2»).

**Решения этого плана (уточняют спеку):**
- `drizzle-orm@0.45.3` не экспортирует `bytea` → свой `customType` (`src/db/bytes.ts`).
- `pixel_events.user_id` — **владелец клетки после события** (nullable: `null` = никто). Для `place` это поставивший игрок. Так восстановление одинаково проигрывает `place`, `mod_rollback`, `mod_clear`; автор модераторского действия пишется в `mod_log` (План 5).
- Владельцы в снапшоте чанка — байты `Int32Array` в порядке байтов платформы (little-endian на всех целевых машинах).
- Постоянный бан хранится как `banned_until = 9999-12-31` и читается как `Infinity`.
- Строк ledger с `item = 'color'` нет: покупка цвета — строка `coins` с `ref.product = 'color'`, разблокировка — таблица `unlocked_colors`.
- Стартовые строки ledger (`reason = 'start'`) пишет `GameRuntime.addPlayer` вместе с первым `player_state`.
- При загрузке `guildMember = true` для всех: членство в гильдии перепроверяется при логине (План 2b).
- Инвариант восстановления: каждый раунд снапшота сохраняет **все** грязные чанки. Значит чанк без снапшота получил все свои события после последнего раунда, и проигрывание лога можно начинать с минимального `last_event_id` по снапшотам, применяя событие к чанку, только если `id > last_event_id` этого чанка.
- Dev-Postgres на порту **54329** (не мешает локальному Postgres на 5432). Тесты используют базу `rave_test` (`TEST_DATABASE_URL`, по умолчанию `postgres://rave:rave@localhost:54329/rave_test`). **Перед `bun test` нужен `bun run db:up`.**

---

## Файловая структура

```
rave-battle/
├── compose.dev.yml                         dev-Postgres (порт 54329) + healthcheck
├── docker/postgres-init/01-test-db.sql     CREATE DATABASE rave_test
├── .env.example                            DATABASE_URL, TEST_DATABASE_URL
├── package.json                            + скрипты db:up / db:down
└── apps/server/
    ├── package.json                        + drizzle-orm, postgres, drizzle-kit; скрипты db:generate
    ├── drizzle.config.ts
    ├── drizzle/                            сгенерированные SQL-миграции (коммитятся)
    └── src/
        ├── db/
        │   ├── bytes.ts                    customType bytea ↔ Uint8Array
        │   ├── schema.ts                   все таблицы спеки (раздел 4)
        │   ├── client.ts                   createDb(url) → { db, close }, типы Db/Tx
        │   ├── migrate.ts                  runMigrations(db)
        │   ├── test-db.ts                  createTestDb(), insertUser() — только для тестов
        │   └── schema.test.ts
        ├── engine/
        │   └── canvas-store.ts             + loadChunk()
        └── persistence/
            ├── codec.ts                    owners ↔ bytes, бан ↔ Date
            ├── codec.test.ts
            ├── batch.ts                    Batch, PlayerSnapshot, ChunkSnapshot, snapshotPlayer()
            ├── write-batch.ts              writeBatch(tx, batch)
            ├── write-batch.test.ts
            ├── load-game.ts                ensureSeason, loadConfig, loadGame
            ├── load-game.test.ts
            ├── runtime.ts                  GameRuntime
            ├── runtime.test.ts
            └── restart.test.ts             сквозные тесты «записали → перезапустились»
```

---

### Task 1: Dev-Postgres в Docker

**Files:**
- Create: `compose.dev.yml`, `docker/postgres-init/01-test-db.sql`, `.env.example`
- Modify: `package.json` (корень)

- [ ] **Step 1: Создать `compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: rave
      POSTGRES_PASSWORD: rave
      POSTGRES_DB: rave
    ports:
      - "54329:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rave -d rave"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  pgdata:
```

- [ ] **Step 2: Создать `docker/postgres-init/01-test-db.sql`**

```sql
CREATE DATABASE rave_test OWNER rave;
```

- [ ] **Step 3: Создать `.env.example`**

```
DATABASE_URL=postgres://rave:rave@localhost:54329/rave
TEST_DATABASE_URL=postgres://rave:rave@localhost:54329/rave_test
```

- [ ] **Step 4: Добавить скрипты в корневой `package.json`**

Секция `scripts` целиком:
```json
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc -p tsconfig.json",
    "db:up": "docker compose -f compose.dev.yml up -d --wait",
    "db:down": "docker compose -f compose.dev.yml down"
  },
```

- [ ] **Step 5: Поднять базу и проверить обе БД**

Run:
```bash
bun run db:up
docker compose -f compose.dev.yml exec -T postgres psql -U rave -d rave -tAc "select datname from pg_database where datname in ('rave','rave_test') order by 1"
```
Expected: контейнер `healthy`; вывод две строки `rave` и `rave_test`.

- [ ] **Step 6: Commit**

```bash
git add compose.dev.yml docker .env.example package.json
git commit -m "chore: add dev postgres via docker compose"
```

---

### Task 2: Схема БД, миграции, клиент

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/drizzle.config.ts`, `apps/server/src/db/bytes.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/test-db.ts`
- Create (generated): `apps/server/drizzle/*`
- Test: `apps/server/src/db/schema.test.ts`

- [ ] **Step 1: Установить зависимости**

Run:
```bash
bun add drizzle-orm@0.45.3 postgres@3.4.9 --cwd apps/server
bun add -d drizzle-kit@0.31.11 --cwd apps/server
```
Expected: зависимости появились в `apps/server/package.json`.

Добавить в `apps/server/package.json` секцию скриптов (рядом с `dependencies`):
```json
  "scripts": {
    "db:generate": "drizzle-kit generate"
  },
```

- [ ] **Step 2: Создать `apps/server/src/db/bytes.ts`**

```ts
import { customType } from "drizzle-orm/pg-core";

/** Postgres bytea as Uint8Array (drizzle-orm 0.45 has no built-in bytea). */
export const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
});
```

- [ ] **Step 3: Создать `apps/server/src/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ItemKey } from "@rave/shared";
import type { LedgerItem, LedgerReason } from "../engine/types";
import { bytes } from "./bytes";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  discordCreatedAt: ts("discord_created_at").notNull(),
  /** 9999-12-31 = permanent ban. */
  bannedUntil: ts("banned_until"),
  banReason: text("ban_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
});

export const playerState = pgTable(
  "player_state",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    coins: integer("coins").notNull(),
    charges: integer("charges").notNull(),
    chargesUpdatedAt: ts("charges_updated_at").notNull(),
    frozenUntil: ts("frozen_until"),
    chargeCapBonus: integer("charge_cap_bonus").notNull().default(0),
    dailyStep: integer("daily_step").notNull().default(0),
    dailyLastClaim: date("daily_last_claim", { mode: "string" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId] })],
);

export const inventory = pgTable(
  "inventory",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    item: text("item").$type<ItemKey>().notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId, t.item] })],
);

export const unlockedColors = pgTable(
  "unlocked_colors",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    colorId: smallint("color_id").notNull(),
    source: text("source").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.colorId] })],
);

export const ledger = pgTable(
  "ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    item: text("item").$type<LedgerItem>().notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").$type<LedgerReason | "start" | "admin">().notNull(),
    ref: jsonb("ref").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)],
);

export const chunkSnapshots = pgTable(
  "chunk_snapshots",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    cx: integer("cx").notNull(),
    cy: integer("cy").notNull(),
    colors: bytes("colors").notNull(),
    owners: bytes("owners").notNull(),
    lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("chunk_snapshots_lookup_idx").on(t.seasonId, t.cx, t.cy, t.id)],
);

export const pixelEvents = pgTable(
  "pixel_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    /** Owner of the cell after the event; null = nobody. */
    userId: integer("user_id").references(() => users.id),
    colorId: smallint("color_id").notNull(),
    prevColorId: smallint("prev_color_id").notNull(),
    prevUserId: integer("prev_user_id").references(() => users.id),
    kind: text("kind").$type<"place" | "mod_rollback" | "mod_clear">().notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("pixel_events_user_idx").on(t.seasonId, t.userId, t.createdAt),
    index("pixel_events_cell_idx").on(t.seasonId, t.x, t.y, t.id),
  ],
);

export const bombs = pgTable(
  "bombs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    ownerId: integer("owner_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull(),
    removedAt: ts("removed_at"),
    removedReason: text("removed_reason").$type<"exploded" | "defused" | "moderated">(),
    removedBy: integer("removed_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("bombs_active_cell_idx").on(t.seasonId, t.x, t.y).where(sql`removed_at is null`),
    index("bombs_owner_idx").on(t.seasonId, t.ownerId),
  ],
);

export const statsDaily = pgTable(
  "stats_daily",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    date: date("date", { mode: "string" }).notNull(),
    pixels: integer("pixels").notNull().default(0),
    coinsFromPixels: integer("coins_from_pixels").notNull().default(0),
    bombsTriggered: integer("bombs_triggered").notNull().default(0),
    explosionsSuffered: integer("explosions_suffered").notNull().default(0),
    selfExplosions: integer("self_explosions").notNull().default(0),
    defused: integer("defused").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId, t.date] })],
);

export const gameConfig = pgTable("game_config", {
  version: serial("version").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  comment: text("comment").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const modLog = pgTable("mod_log", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  targetUserId: integer("target_user_id").references(() => users.id),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});
```

Названия свойств `statsDaily` (`pixels`, `coinsFromPixels`, `bombsTriggered`, `explosionsSuffered`, `selfExplosions`, `defused`) **обязаны** совпадать с `StatKey` движка — на этом построен `writeBatch`.

- [ ] **Step 4: Создать `apps/server/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 5: Сгенерировать миграцию**

Run:
```bash
cd apps/server && bunx drizzle-kit generate --name init && cd ../..
```
Expected: создан `apps/server/drizzle/0000_init.sql` и `apps/server/drizzle/meta/*`. Проверить, что SQL содержит `CREATE UNIQUE INDEX "bombs_active_cell_idx" ... WHERE removed_at is null` и столбцы `"colors" bytea`:
```bash
grep -E 'bombs_active_cell_idx|bytea' apps/server/drizzle/0000_init.sql
```
Expected: 3 строки (индекс + два bytea-столбца).

- [ ] **Step 6: Создать `apps/server/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle({ client, schema });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
```

- [ ] **Step 7: Создать `apps/server/src/db/migrate.ts`**

```ts
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client";

export const MIGRATIONS_DIR = join(import.meta.dir, "../../drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
```

- [ ] **Step 8: Создать `apps/server/src/db/test-db.ts`**

```ts
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";
import { users } from "./schema";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://rave:rave@localhost:54329/rave_test";

/** Test database handle. `reset()` recreates the schema from migrations (serial ids restart at 1). */
export function createTestDb() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  const reset = async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  };
  return { db, reset, close };
}

export async function insertUser(
  db: Db,
  name: string,
  discordCreatedAt = new Date("2020-01-01T00:00:00Z"),
): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({ discordId: `discord-${name}`, username: name, discordCreatedAt })
    .returning({ id: users.id });
  return row!.id;
}
```

- [ ] **Step 9: Написать тест схемы**

`apps/server/src/db/schema.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { bombs, seasons } from "./schema";
import { createTestDb, insertUser } from "./test-db";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

test("migrations create every table of the spec", async () => {
  const rows = (await t.db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  )) as unknown as Array<{ table_name: string }>;
  expect(rows.map((r) => r.table_name)).toEqual([
    "bombs",
    "chunk_snapshots",
    "game_config",
    "inventory",
    "ledger",
    "mod_log",
    "pixel_events",
    "player_state",
    "seasons",
    "sessions",
    "stats_daily",
    "unlocked_colors",
    "users",
  ]);
});

test("a cell has at most one active bomb", async () => {
  const ownerId = await insertUser(t.db, "owner");
  const [season] = await t.db.insert(seasons).values({ name: "S" }).returning();
  const bomb = { seasonId: season!.id, x: 1, y: 1, ownerId, createdAt: new Date() };

  await t.db.insert(bombs).values(bomb);
  await expect(t.db.insert(bombs).values(bomb).execute()).rejects.toThrow();

  await t.db.update(bombs).set({ removedAt: new Date(), removedReason: "defused" });
  await t.db.insert(bombs).values(bomb);
  const count = (await t.db.execute(sql`select count(*)::int as n from bombs`)) as unknown as Array<{ n: number }>;
  expect(count[0]?.n).toBe(2);
});
```

- [ ] **Step 10: Запустить тест**

Run: `bun test apps/server/src/db/schema.test.ts`
Expected: PASS, 2 tests. (Если `ECONNREFUSED` — не поднята база: `bun run db:up`.)

- [ ] **Step 11: Typecheck и весь набор**

Run: `bun run typecheck && bun test`
Expected: typecheck exit 0; 67 pass (65 старых + 2).

- [ ] **Step 12: Commit**

```bash
git add apps/server bun.lock
git commit -m "feat(db): add drizzle schema, migrations and test database"
```

---

### Task 3: `CanvasStore.loadChunk`

**Files:**
- Modify: `apps/server/src/engine/canvas-store.ts`
- Test: `apps/server/src/engine/canvas-store.test.ts` (дописать)

- [ ] **Step 1: Дописать падающий тест**

В конец `describe("CanvasStore", ...)` в `apps/server/src/engine/canvas-store.test.ts`:
```ts
  test("loadChunk replaces a chunk and rebuilds territory", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(0, 0, 1, 9);
    const colors = new Uint8Array(256 * 256);
    const owners = new Int32Array(256 * 256);
    colors[0] = 5;
    owners[0] = 7;
    owners[1] = 7;
    owners[256] = 8;
    canvas.loadChunk(0, 0, { colors, owners });

    expect(canvas.get(0, 0)).toEqual({ colorId: 5, ownerId: 7 });
    expect(canvas.get(0, 1)).toEqual({ colorId: 0, ownerId: 8 });
    expect(canvas.territoryOf(7)).toBe(2);
    expect(canvas.territoryOf(8)).toBe(1);
    expect(canvas.territoryOf(9)).toBe(0);
  });

  test("loadChunk rejects wrongly sized buffers", () => {
    const canvas = new CanvasStore(512, 512);
    expect(() => canvas.loadChunk(0, 0, { colors: new Uint8Array(10), owners: new Int32Array(10) })).toThrow();
  });
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/engine/canvas-store.test.ts`
Expected: FAIL — `canvas.loadChunk is not a function`.

- [ ] **Step 3: Реализовать**

В класс `CanvasStore` (`apps/server/src/engine/canvas-store.ts`) после `getChunk`:
```ts
  /** Replaces a whole chunk (recovery) and rebuilds territory for its cells. */
  loadChunk(cx: number, cy: number, chunk: Chunk): void {
    const cells = CHUNK_SIZE * CHUNK_SIZE;
    if (chunk.colors.length !== cells || chunk.owners.length !== cells) {
      throw new Error(`Chunk ${cx}:${cy} must have ${cells} cells`);
    }
    const key = chunkKey(cx, cy);
    const old = this.chunks.get(key);
    if (old) for (const owner of old.owners) this.addTerritory(owner, -1);
    for (const owner of chunk.owners) this.addTerritory(owner, 1);
    this.chunks.set(key, chunk);
  }
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/engine/canvas-store.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add chunk loading for recovery"
```

---

### Task 4: Кодеки

**Files:**
- Create: `apps/server/src/persistence/codec.ts`
- Test: `apps/server/src/persistence/codec.test.ts`

- [ ] **Step 1: Написать падающий тест**

`apps/server/src/persistence/codec.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { banFromDate, banToDate, bytesToOwners, ownersToBytes, PERMANENT_BAN_DATE } from "./codec";

describe("owners codec", () => {
  test("round-trips an Int32Array through bytes", () => {
    const owners = new Int32Array([0, 1, 7, 2_000_000_000]);
    const bytes = ownersToBytes(owners);
    expect(bytes.byteLength).toBe(16);
    expect(Array.from(bytesToOwners(bytes))).toEqual([0, 1, 7, 2_000_000_000]);
  });

  test("decoding copies, so the result does not alias the input", () => {
    const bytes = ownersToBytes(new Int32Array([5]));
    const owners = bytesToOwners(bytes);
    bytes[0] = 9;
    expect(owners[0]).toBe(5);
  });
});

describe("ban codec", () => {
  test("null stays null", () => {
    expect(banToDate(null)).toBeNull();
    expect(banFromDate(null)).toBeNull();
  });

  test("a timed ban round-trips", () => {
    const until = Date.UTC(2026, 9, 10);
    expect(banFromDate(banToDate(until))).toBe(until);
  });

  test("a permanent ban is stored as 9999-12-31 and read back as Infinity", () => {
    expect(banToDate(Number.POSITIVE_INFINITY)).toEqual(PERMANENT_BAN_DATE);
    expect(banFromDate(PERMANENT_BAN_DATE)).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/persistence/codec.test.ts`
Expected: FAIL — `Cannot find module './codec'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/persistence/codec.ts`:
```ts
/** Permanent bans are stored as this date and read back as Infinity. */
export const PERMANENT_BAN_DATE = new Date("9999-12-31T00:00:00.000Z");

/** Raw bytes of the owners array (platform byte order). */
export function ownersToBytes(owners: Int32Array): Uint8Array {
  return new Uint8Array(owners.buffer, owners.byteOffset, owners.byteLength);
}

export function bytesToOwners(bytes: Uint8Array): Int32Array {
  const copy = bytes.slice();
  return new Int32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function banToDate(bannedUntil: number | null): Date | null {
  if (bannedUntil === null) return null;
  return Number.isFinite(bannedUntil) ? new Date(bannedUntil) : PERMANENT_BAN_DATE;
}

export function banFromDate(date: Date | null): number | null {
  if (date === null) return null;
  return date.getTime() >= PERMANENT_BAN_DATE.getTime() ? Number.POSITIVE_INFINITY : date.getTime();
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/persistence/codec.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(persistence): add owners and ban codecs"
```

---

### Task 5: `Batch` и `writeBatch`

**Files:**
- Create: `apps/server/src/persistence/batch.ts`, `apps/server/src/persistence/write-batch.ts`
- Test: `apps/server/src/persistence/write-batch.test.ts`

- [ ] **Step 1: Создать `batch.ts`**

`apps/server/src/persistence/batch.ts`:
```ts
import type { EngineEvent, Inventory, PlayerState, UserId } from "../engine/types";

/** The part of PlayerState stored in player_state + inventory. */
export interface PlayerSnapshot {
  userId: UserId;
  coins: number;
  charges: number;
  chargesUpdatedAt: number;
  frozenUntil: number;
  chargeCapBonus: number;
  dailyStep: number;
  dailyLastClaim: string | null;
  inventory: Inventory;
}

export interface ChunkSnapshot {
  cx: number;
  cy: number;
  colors: Uint8Array;
  owners: Int32Array;
}

/** One transaction: a consistent cut of everything the engine did since the previous batch. */
export interface Batch {
  seasonId: number;
  events: EngineEvent[];
  /** Latest state of every player touched by `events`. */
  players: PlayerSnapshot[];
  /** Players created since the previous batch, with their creation time. */
  newPlayers: Array<{ player: PlayerSnapshot; at: number }>;
  /** Copies of chunks taken at the same moment as `events` were drained. */
  chunks: ChunkSnapshot[];
}

export function snapshotPlayer(p: PlayerState): PlayerSnapshot {
  return {
    userId: p.userId,
    coins: p.coins,
    charges: p.charges,
    chargesUpdatedAt: p.chargesUpdatedAt,
    frozenUntil: p.frozenUntil,
    chargeCapBonus: p.chargeCapBonus,
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
    inventory: { ...p.inventory },
  };
}
```

- [ ] **Step 2: Написать падающие тесты**

`apps/server/src/persistence/write-batch.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { asc, eq, ne } from "drizzle-orm";
import { bombs, chunkSnapshots, inventory, ledger, pixelEvents, playerState, seasons, statsDaily, unlockedColors } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { makeEngine, T0 } from "../engine/test-utils";
import { snapshotPlayer, type Batch } from "./batch";
import { bytesToOwners } from "./codec";
import { writeBatch } from "./write-batch";

const t = createTestDb();
let seasonId = 0;
let a = 0;
let b = 0;

beforeEach(async () => {
  await t.reset();
  a = await insertUser(t.db, "a");
  b = await insertUser(t.db, "b");
  const [season] = await t.db.insert(seasons).values({ name: "S" }).returning();
  seasonId = season!.id;
});
afterAll(() => t.close());

const write = (batch: Partial<Batch>) =>
  t.db.transaction((tx) =>
    writeBatch(tx, { seasonId, events: [], players: [], newPlayers: [], chunks: [], ...batch }),
  );

/** Engine with players a and b already persisted. */
async function setup() {
  const ctx = makeEngine();
  const pa = ctx.addPlayer(a);
  const pb = ctx.addPlayer(b);
  await write({ newPlayers: [{ player: snapshotPlayer(pa), at: T0 }, { player: snapshotPlayer(pb), at: T0 }] });
  return { ...ctx, pa, pb };
}

describe("writeBatch", () => {
  test("new players get state, inventory and starting ledger rows", async () => {
    await setup();
    const [state] = await t.db.select().from(playerState).where(eq(playerState.userId, a));
    expect(state).toMatchObject({ coins: 100, charges: 10, chargeCapBonus: 0, dailyStep: 0, dailyLastClaim: null, frozenUntil: null });
    expect(state!.chargesUpdatedAt.getTime()).toBe(T0);

    const items = await t.db.select().from(inventory).where(eq(inventory.userId, a)).orderBy(asc(inventory.item));
    expect(items.map((i) => [i.item, i.amount])).toEqual([["bomb", 3], ["defuser", 0], ["detector", 5]]);

    const start = await t.db.select().from(ledger).where(eq(ledger.userId, a)).orderBy(asc(ledger.id));
    expect(start.map((r) => [r.item, r.delta, r.balanceAfter, r.reason])).toEqual([
      ["coins", 100, 100, "start"],
      ["bomb", 3, 3, "start"],
      ["detector", 5, 5, "start"],
    ]);
  });

  test("pixels, bombs, explosion ledger, stats and player state", async () => {
    const { engine, pa, pb } = await setup();
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.placePixel(a, { x: 6, y: 5, colorId: 4, withBomb: false }, T0);
    engine.placePixel(b, { x: 5, y: 5, colorId: 9, withBomb: false }, T0 + 1000);
    await write({ events: engine.drainEvents(), players: [snapshotPlayer(pa), snapshotPlayer(pb)] });

    const pixels = await t.db.select().from(pixelEvents).orderBy(asc(pixelEvents.id));
    expect(pixels.map((p) => [p.x, p.y, p.userId, p.colorId, p.prevColorId, p.prevUserId, p.kind])).toEqual([
      [5, 5, a, 3, 0, null, "place"],
      [6, 5, a, 4, 0, null, "place"],
    ]);

    const [bomb] = await t.db.select().from(bombs);
    expect(bomb).toMatchObject({ x: 5, y: 5, ownerId: a, removedReason: "exploded", removedBy: b });
    expect(bomb!.removedAt?.getTime()).toBe(T0 + 1000);

    const rows = await t.db.select().from(ledger).where(ne(ledger.reason, "start")).orderBy(asc(ledger.id));
    expect(rows.map((r) => [r.userId, r.item, r.delta, r.reason])).toEqual([
      [a, "bomb", -1, "use"],
      [b, "coins", -10, "explosion"],
      [a, "coins", 15, "bomb_bonus"],
    ]);

    const stats = await t.db.select().from(statsDaily).orderBy(asc(statsDaily.userId));
    expect(stats.map((s) => [s.userId, s.date, s.pixels, s.coinsFromPixels, s.bombsTriggered, s.explosionsSuffered])).toEqual([
      [a, "2026-10-07", 2, 2, 1, 0],
      [b, "2026-10-07", 0, 0, 0, 1],
    ]);

    const states = await t.db.select().from(playerState).orderBy(asc(playerState.userId));
    expect(states.map((s) => [s.userId, s.coins, s.charges])).toEqual([
      [a, 117, 8],
      [b, 90, 9],
    ]);
    expect(states[1]!.frozenUntil?.getTime()).toBe(T0 + 61_000);
    const [aBombs] = await t.db.select().from(inventory).where(eq(inventory.userId, a)).orderBy(asc(inventory.item));
    expect(aBombs).toMatchObject({ item: "bomb", amount: 2 });
  });

  test("stats accumulate across batches", async () => {
    const { engine } = await setup();
    engine.placePixel(a, { x: 1, y: 1, colorId: 3, withBomb: false }, T0);
    await write({ events: engine.drainEvents() });
    engine.placePixel(a, { x: 2, y: 1, colorId: 3, withBomb: false }, T0);
    await write({ events: engine.drainEvents() });
    const [stats] = await t.db.select().from(statsDaily);
    expect(stats).toMatchObject({ pixels: 2, coinsFromPixels: 2 });
  });

  test("a defused bomb is closed with reason defused", async () => {
    const { engine, pb } = await setup();
    pb.inventory.defuser = 1;
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.defuse(b, { x: 5, y: 5 }, T0 + 5);
    await write({ events: engine.drainEvents() });
    const [bomb] = await t.db.select().from(bombs);
    expect(bomb).toMatchObject({ removedReason: "defused", removedBy: b });
  });

  test("color unlocks are written once", async () => {
    await setup();
    const unlock = { type: "color_unlocked" as const, userId: a, colorId: 32, source: "shop" as const, at: T0 };
    await write({ events: [unlock] });
    await write({ events: [unlock] });
    const rows = await t.db.select().from(unlockedColors);
    expect(rows.map((r) => [r.userId, r.colorId, r.source])).toEqual([[a, 32, "shop"]]);
  });

  test("chunk snapshots store bytes and the last pixel event id", async () => {
    const { engine, canvas } = await setup();
    engine.placePixel(a, { x: 1, y: 1, colorId: 3, withBomb: false }, T0);
    engine.placePixel(a, { x: 2, y: 1, colorId: 4, withBomb: false }, T0);
    const chunk = canvas.getChunk(0, 0)!;
    await write({ events: engine.drainEvents(), chunks: [{ cx: 0, cy: 0, colors: chunk.colors.slice(), owners: chunk.owners.slice() }] });

    const [snap] = await t.db.select().from(chunkSnapshots);
    expect(snap).toMatchObject({ seasonId, cx: 0, cy: 0, lastEventId: 2 });
    expect(snap!.colors[256 + 2]).toBe(4);
    expect(bytesToOwners(snap!.owners)[256 + 1]).toBe(a);
  });
});
```

- [ ] **Step 3: Запустить, убедиться что падает**

Run: `bun test apps/server/src/persistence/write-batch.test.ts`
Expected: FAIL — `Cannot find module './write-batch'`.

- [ ] **Step 4: Реализовать `write-batch.ts`**

`apps/server/src/persistence/write-batch.ts`:
```ts
import { ITEM_KEYS } from "@rave/shared";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/client";
import { bombs, chunkSnapshots, inventory, ledger, pixelEvents, playerState, statsDaily, unlockedColors } from "../db/schema";
import type { EngineEvent, LedgerItem, StatKey } from "../engine/types";
import type { Batch, PlayerSnapshot } from "./batch";
import { ownersToBytes } from "./codec";

type EventOf<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

function ofType<T extends EngineEvent["type"]>(events: EngineEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** Writes one batch. Must run inside a transaction. Order matters: players first, snapshots last. */
export async function writeBatch(tx: Tx, batch: Batch): Promise<void> {
  for (const { player, at } of batch.newPlayers) await insertNewPlayer(tx, batch.seasonId, player, at);
  await insertPixels(tx, batch);
  await applyBombEvents(tx, batch);
  await insertLedger(tx, batch);
  await addStats(tx, batch);
  await insertColorUnlocks(tx, batch);
  for (const player of batch.players) await upsertPlayer(tx, batch.seasonId, player);
  if (batch.chunks.length > 0) await insertChunkSnapshots(tx, batch);
}

async function insertNewPlayer(tx: Tx, seasonId: number, p: PlayerSnapshot, at: number): Promise<void> {
  await upsertPlayer(tx, seasonId, p);
  const start: Array<{ item: LedgerItem; amount: number }> = [
    { item: "coins", amount: p.coins },
    ...ITEM_KEYS.map((item) => ({ item, amount: p.inventory[item] })),
  ].filter((s) => s.amount > 0);
  if (start.length === 0) return;
  await tx.insert(ledger).values(
    start.map((s) => ({
      userId: p.userId,
      seasonId,
      item: s.item,
      delta: s.amount,
      balanceAfter: s.amount,
      reason: "start" as const,
      createdAt: new Date(at),
    })),
  );
}

async function upsertPlayer(tx: Tx, seasonId: number, p: PlayerSnapshot): Promise<void> {
  const state = {
    coins: p.coins,
    charges: p.charges,
    chargesUpdatedAt: new Date(p.chargesUpdatedAt),
    frozenUntil: p.frozenUntil > 0 ? new Date(p.frozenUntil) : null,
    chargeCapBonus: p.chargeCapBonus,
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
  };
  await tx
    .insert(playerState)
    .values({ userId: p.userId, seasonId, ...state })
    .onConflictDoUpdate({ target: [playerState.userId, playerState.seasonId], set: state });
  await tx
    .insert(inventory)
    .values(ITEM_KEYS.map((item) => ({ userId: p.userId, seasonId, item, amount: p.inventory[item] })))
    .onConflictDoUpdate({
      target: [inventory.userId, inventory.seasonId, inventory.item],
      set: { amount: sql`excluded.amount` },
    });
}

async function insertPixels(tx: Tx, batch: Batch): Promise<void> {
  const pixels = ofType(batch.events, "pixel");
  if (pixels.length === 0) return;
  await tx.insert(pixelEvents).values(
    pixels.map((e) => ({
      seasonId: batch.seasonId,
      x: e.x,
      y: e.y,
      userId: e.userId || null,
      colorId: e.colorId,
      prevColorId: e.prevColorId,
      prevUserId: e.prevUserId || null,
      kind: "place" as const,
      createdAt: new Date(e.at),
    })),
  );
}

/** Sequential on purpose: a batch may add and then remove a bomb on the same cell. */
async function applyBombEvents(tx: Tx, batch: Batch): Promise<void> {
  for (const e of batch.events) {
    if (e.type === "bomb_added") {
      await tx.insert(bombs).values({ seasonId: batch.seasonId, x: e.x, y: e.y, ownerId: e.ownerId, createdAt: new Date(e.at) });
    } else if (e.type === "bomb_removed") {
      await tx
        .update(bombs)
        .set({ removedAt: new Date(e.at), removedReason: e.reason, removedBy: e.removedBy })
        .where(and(eq(bombs.seasonId, batch.seasonId), eq(bombs.x, e.x), eq(bombs.y, e.y), isNull(bombs.removedAt)));
    }
  }
}

async function insertLedger(tx: Tx, batch: Batch): Promise<void> {
  const rows = ofType(batch.events, "ledger");
  if (rows.length === 0) return;
  await tx.insert(ledger).values(
    rows.map((e) => ({
      userId: e.userId,
      seasonId: batch.seasonId,
      item: e.item,
      delta: e.delta,
      balanceAfter: e.balanceAfter,
      reason: e.reason,
      ref: e.ref,
      createdAt: new Date(e.at),
    })),
  );
}

async function addStats(tx: Tx, batch: Batch): Promise<void> {
  const totals = new Map<string, { userId: number; day: string; counts: Partial<Record<StatKey, number>> }>();
  for (const e of ofType(batch.events, "stat")) {
    const key = `${e.userId}|${e.day}`;
    const entry = totals.get(key) ?? { userId: e.userId, day: e.day, counts: {} };
    entry.counts[e.stat] = (entry.counts[e.stat] ?? 0) + e.delta;
    totals.set(key, entry);
  }
  for (const { userId, day, counts } of totals.values()) {
    const set: Partial<Record<StatKey, SQL>> = {};
    for (const [stat, delta] of Object.entries(counts) as Array<[StatKey, number]>) {
      set[stat] = sql`${statsDaily[stat]} + ${delta}`;
    }
    await tx
      .insert(statsDaily)
      .values({ userId, seasonId: batch.seasonId, date: day, ...counts })
      .onConflictDoUpdate({ target: [statsDaily.userId, statsDaily.seasonId, statsDaily.date], set });
  }
}

async function insertColorUnlocks(tx: Tx, batch: Batch): Promise<void> {
  const unlocks = ofType(batch.events, "color_unlocked");
  if (unlocks.length === 0) return;
  await tx
    .insert(unlockedColors)
    .values(unlocks.map((e) => ({ userId: e.userId, colorId: e.colorId, source: e.source, createdAt: new Date(e.at) })))
    .onConflictDoNothing();
}

/** Runs after this batch's pixels are inserted, so max(id) covers exactly the copied chunk state. */
async function insertChunkSnapshots(tx: Tx, batch: Batch): Promise<void> {
  const [row] = await tx
    .select({ maxId: sql<number>`coalesce(max(${pixelEvents.id}), 0)`.mapWith(Number) })
    .from(pixelEvents)
    .where(eq(pixelEvents.seasonId, batch.seasonId));
  const lastEventId = row?.maxId ?? 0;
  await tx.insert(chunkSnapshots).values(
    batch.chunks.map((c) => ({
      seasonId: batch.seasonId,
      cx: c.cx,
      cy: c.cy,
      colors: c.colors,
      owners: ownersToBytes(c.owners),
      lastEventId,
    })),
  );
}
```

- [ ] **Step 5: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/persistence/write-batch.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(persistence): write engine batches to postgres"
```

---

### Task 6: `loadGame`

**Files:**
- Create: `apps/server/src/persistence/load-game.ts`
- Test: `apps/server/src/persistence/load-game.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/persistence/load-game.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { sql } from "drizzle-orm";
import { gameConfig, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { makeEngine, T0 } from "../engine/test-utils";
import { snapshotPlayer } from "./batch";
import { PERMANENT_BAN_DATE } from "./codec";
import { loadGame } from "./load-game";
import { writeBatch } from "./write-batch";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

const count = async (table: "seasons" | "game_config") => {
  const rows = (await t.db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`)) as unknown as Array<{ n: number }>;
  return rows[0]?.n;
};

describe("loadGame", () => {
  test("first start creates a season and the default config", async () => {
    const { engine, seasonId } = await loadGame(t.db, T0);
    expect(seasonId).toBe(1);
    expect(engine.config).toEqual(defaultConfig);
    expect(engine.canvas.width).toBe(512);
    expect(await count("seasons")).toBe(1);
    expect(await count("game_config")).toBe(1);
  });

  test("later starts reuse the open season and the latest config version", async () => {
    await loadGame(t.db, T0);
    const changed = structuredClone(defaultConfig);
    changed.coinsPerPixel = 2;
    await t.db.insert(gameConfig).values({ data: changed, comment: "v2" });
    const { engine, seasonId } = await loadGame(t.db, T0);
    expect(seasonId).toBe(1);
    expect(engine.config.coinsPerPixel).toBe(2);
    expect(await count("seasons")).toBe(1);
  });

  test("an invalid stored config fails the start", async () => {
    await t.db.insert(gameConfig).values({ data: { nope: true } });
    await expect(loadGame(t.db, T0)).rejects.toThrow();
  });

  test("restores canvas, players, bombs and bans from written batches", async () => {
    const a = await insertUser(t.db, "a", new Date(T0 - 400 * 86_400_000));
    const b = await insertUser(t.db, "b");
    const { seasonId } = await loadGame(t.db, T0);

    const { engine, addPlayer } = makeEngine();
    const pa = addPlayer(a);
    const pb = addPlayer(b);
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.placePixel(b, { x: 300, y: 10, colorId: 4, withBomb: false }, T0);
    engine.claimDaily(a, T0);
    await t.db.transaction((tx) =>
      writeBatch(tx, {
        seasonId,
        events: engine.drainEvents(),
        players: [snapshotPlayer(pa), snapshotPlayer(pb)],
        newPlayers: [{ player: snapshotPlayer(pa), at: T0 }, { player: snapshotPlayer(pb), at: T0 }],
        chunks: [],
      }),
    );
    await t.db.update(users).set({ bannedUntil: PERMANENT_BAN_DATE }).where(sql`${users.id} = ${b}`);

    const loaded = (await loadGame(t.db, T0)).engine;
    expect(loaded.canvas.get(5, 5)).toEqual({ colorId: 3, ownerId: a });
    expect(loaded.canvas.get(300, 10)).toEqual({ colorId: 4, ownerId: b });
    expect(loaded.canvas.territoryOf(a)).toBe(1);
    expect(loaded.bombs.get(5, 5)?.ownerId).toBe(a);

    const la = loaded.players.get(a);
    expect(la).toMatchObject({
      coins: pa.coins,
      charges: pa.charges,
      chargesUpdatedAt: pa.chargesUpdatedAt,
      frozenUntil: 0,
      inventory: pa.inventory,
      dailyStep: 1,
      dailyLastClaim: "2026-10-07",
      bannedUntil: null,
      accountCreatedAt: T0 - 400 * 86_400_000,
      guildMember: true,
    });
    expect(loaded.players.get(b).bannedUntil).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/persistence/load-game.test.ts`
Expected: FAIL — `Cannot find module './load-game'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/persistence/load-game.ts`:
```ts
import { CHUNK_SIZE, DAY_MS, dateKey, defaultConfig, gameConfigSchema, type GameConfig } from "@rave/shared";
import { and, asc, desc, eq, gt, gte, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { bombs, chunkSnapshots, gameConfig, inventory, pixelEvents, playerState, seasons, unlockedColors, users } from "../db/schema";
import { AntiFarm } from "../engine/anti-farm";
import { BombStore } from "../engine/bomb-store";
import { CanvasStore } from "../engine/canvas-store";
import { GameEngine } from "../engine/engine";
import { PlayerRegistry } from "../engine/player";
import type { Inventory } from "../engine/types";
import { banFromDate, bytesToOwners } from "./codec";

export interface LoadedGame {
  engine: GameEngine;
  seasonId: number;
}

/** Builds the engine from the database. `now` decides "today" for the anti-farm counters. */
export async function loadGame(db: Db, now: number): Promise<LoadedGame> {
  const seasonId = await ensureSeason(db);
  const cfg = await loadConfig(db);
  const canvas = new CanvasStore(cfg.canvas.width, cfg.canvas.height);
  await loadCanvas(db, seasonId, canvas);
  const players = new PlayerRegistry();
  await loadPlayers(db, seasonId, players);
  const bombStore = new BombStore();
  await loadBombs(db, seasonId, bombStore);
  const antiFarm = new AntiFarm();
  await seedAntiFarm(db, seasonId, cfg, antiFarm, now);
  return { engine: new GameEngine(cfg, canvas, bombStore, players, antiFarm), seasonId };
}

export async function ensureSeason(db: Db): Promise<number> {
  const [open] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(isNull(seasons.endedAt))
    .orderBy(desc(seasons.id))
    .limit(1);
  if (open) return open.id;
  const [created] = await db.insert(seasons).values({ name: "Season 1" }).returning({ id: seasons.id });
  return created!.id;
}

export async function loadConfig(db: Db): Promise<GameConfig> {
  const [latest] = await db.select().from(gameConfig).orderBy(desc(gameConfig.version)).limit(1);
  if (latest) return gameConfigSchema.parse(latest.data);
  await db.insert(gameConfig).values({ data: defaultConfig, comment: "initial" });
  return gameConfigSchema.parse(defaultConfig);
}

/**
 * Latest snapshot per chunk, then the pixel log after it. Every snapshot round saves all dirty
 * chunks, so a chunk without a snapshot only has events newer than the oldest snapshot.
 */
async function loadCanvas(db: Db, seasonId: number, canvas: CanvasStore): Promise<void> {
  const snapshots = await db
    .selectDistinctOn([chunkSnapshots.cx, chunkSnapshots.cy])
    .from(chunkSnapshots)
    .where(eq(chunkSnapshots.seasonId, seasonId))
    .orderBy(chunkSnapshots.cx, chunkSnapshots.cy, desc(chunkSnapshots.id));

  const lastIdByChunk = new Map<string, number>();
  for (const s of snapshots) {
    canvas.loadChunk(s.cx, s.cy, { colors: s.colors, owners: bytesToOwners(s.owners) });
    lastIdByChunk.set(`${s.cx}:${s.cy}`, s.lastEventId);
  }

  const fromId = snapshots.length > 0 ? Math.min(...lastIdByChunk.values()) : 0;
  const events = await db
    .select({ id: pixelEvents.id, x: pixelEvents.x, y: pixelEvents.y, userId: pixelEvents.userId, colorId: pixelEvents.colorId })
    .from(pixelEvents)
    .where(and(eq(pixelEvents.seasonId, seasonId), gt(pixelEvents.id, fromId)))
    .orderBy(asc(pixelEvents.id));
  for (const e of events) {
    const chunkLastId = lastIdByChunk.get(`${Math.floor(e.x / CHUNK_SIZE)}:${Math.floor(e.y / CHUNK_SIZE)}`) ?? 0;
    if (e.id > chunkLastId) canvas.set(e.x, e.y, e.colorId, e.userId ?? 0);
  }
}

async function loadPlayers(db: Db, seasonId: number, registry: PlayerRegistry): Promise<void> {
  const rows = await db
    .select({ state: playerState, discordCreatedAt: users.discordCreatedAt, bannedUntil: users.bannedUntil })
    .from(playerState)
    .innerJoin(users, eq(users.id, playerState.userId))
    .where(eq(playerState.seasonId, seasonId));

  const inventories = new Map<number, Inventory>();
  for (const row of await db.select().from(inventory).where(eq(inventory.seasonId, seasonId))) {
    const inv = inventories.get(row.userId) ?? { bomb: 0, detector: 0, defuser: 0 };
    inv[row.item] = row.amount;
    inventories.set(row.userId, inv);
  }

  const unlocked = new Map<number, Set<number>>();
  for (const row of await db.select().from(unlockedColors)) {
    const set = unlocked.get(row.userId) ?? new Set<number>();
    set.add(row.colorId);
    unlocked.set(row.userId, set);
  }

  for (const { state, discordCreatedAt, bannedUntil } of rows) {
    registry.add({
      userId: state.userId,
      coins: state.coins,
      charges: state.charges,
      chargesUpdatedAt: state.chargesUpdatedAt.getTime(),
      frozenUntil: state.frozenUntil?.getTime() ?? 0,
      chargeCapBonus: state.chargeCapBonus,
      inventory: inventories.get(state.userId) ?? { bomb: 0, detector: 0, defuser: 0 },
      unlockedColors: unlocked.get(state.userId) ?? new Set(),
      dailyStep: state.dailyStep,
      dailyLastClaim: state.dailyLastClaim,
      bannedUntil: banFromDate(bannedUntil),
      accountCreatedAt: discordCreatedAt.getTime(),
      // Re-checked at login (Plan 2b); offline players cannot act anyway.
      guildMember: true,
    });
  }
}

async function loadBombs(db: Db, seasonId: number, store: BombStore): Promise<void> {
  const rows = await db
    .select()
    .from(bombs)
    .where(and(eq(bombs.seasonId, seasonId), isNull(bombs.removedAt)));
  for (const r of rows) store.add({ x: r.x, y: r.y, ownerId: r.ownerId, createdAt: r.createdAt.getTime() });
}

/** Replays today's rated explosions so a restart does not reset the per-pair limit. */
async function seedAntiFarm(db: Db, seasonId: number, cfg: GameConfig, antiFarm: AntiFarm, now: number): Promise<void> {
  const today = dateKey(now, cfg.daily.timezone);
  const rows = await db
    .select({ ownerId: bombs.ownerId, removedBy: bombs.removedBy, removedAt: bombs.removedAt })
    .from(bombs)
    .where(and(eq(bombs.seasonId, seasonId), eq(bombs.removedReason, "exploded"), gte(bombs.removedAt, new Date(now - 2 * DAY_MS))))
    .orderBy(asc(bombs.removedAt), asc(bombs.id));
  for (const r of rows) {
    if (r.removedBy === null || r.removedAt === null || r.removedBy === r.ownerId) continue;
    if (dateKey(r.removedAt.getTime(), cfg.daily.timezone) !== today) continue;
    antiFarm.register(today, r.ownerId, r.removedBy, cfg.antiFarm.maxRatedPerPairPerDay);
  }
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/persistence/load-game.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(persistence): load game state from postgres"
```

---

### Task 7: `GameRuntime`

**Files:**
- Create: `apps/server/src/persistence/runtime.ts`
- Test: `apps/server/src/persistence/runtime.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/persistence/runtime.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "../db/client";
import { chunkSnapshots, pixelEvents, playerState } from "../db/schema";
import { createTestDb, insertUser, TEST_DATABASE_URL } from "../db/test-db";
import { DAY_MS, makeEngine, T0 } from "../engine/test-utils";
import { loadGame } from "./load-game";
import { GameRuntime } from "./runtime";

const t = createTestDb();
let clock = T0;
let a = 0;

beforeEach(async () => {
  await t.reset();
  clock = T0;
  a = await insertUser(t.db, "a");
});
afterAll(() => t.close());

async function boot(options: { snapshotIntervalMs?: number } = {}) {
  const { engine, seasonId } = await loadGame(t.db, clock);
  const fatal: unknown[] = [];
  const runtime = new GameRuntime(engine, t.db, {
    seasonId,
    now: () => clock,
    flushIntervalMs: 0,
    snapshotIntervalMs: options.snapshotIntervalMs ?? 60_000,
    onFatal: (error) => fatal.push(error),
  });
  return { engine, runtime, fatal };
}

const pixel = (x: number, y: number, colorId = 3) => ({ x, y, colorId, withBomb: false });

describe("GameRuntime", () => {
  test("addPlayer persists the new player", async () => {
    const { runtime } = await boot();
    const player = await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    expect(player.coins).toBe(100);
    const rows = await t.db.select().from(playerState);
    expect(rows.map((r) => [r.userId, r.coins])).toEqual([[a, 100]]);
  });

  test("run resolves with the command result after it is committed", async () => {
    const { runtime, fatal } = await boot();
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    const results = await Promise.all([
      runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now)),
      runtime.run((engine, now) => engine.placePixel(a, pixel(-1, 1), now)),
    ]);
    expect(results).toEqual([{ ok: true, outcome: "placed" }, { ok: false, code: "out_of_bounds" }]);
    expect(await t.db.select().from(pixelEvents)).toHaveLength(1);
    const [state] = await t.db.select().from(playerState);
    expect(state?.coins).toBe(101);
    expect(fatal).toEqual([]);
  });

  test("forced snapshot writes each dirty chunk once", async () => {
    const { runtime } = await boot();
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    await runtime.run((engine, now) => engine.placePixel(a, pixel(300, 300), now));
    await runtime.flush({ snapshot: true });
    await runtime.flush({ snapshot: true });
    const snaps = await t.db.select().from(chunkSnapshots);
    expect(snaps.map((s) => `${s.cx}:${s.cy}`).sort()).toEqual(["0:0", "1:1"]);
  });

  test("snapshots are taken automatically after the interval", async () => {
    const { runtime } = await boot({ snapshotIntervalMs: 1000 });
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(0);
    clock += 1000;
    await runtime.run((engine, now) => engine.placePixel(a, pixel(2, 1), now));
    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(1);
  });

  test("a failed commit rejects waiting commands, calls onFatal once and stops the runtime", async () => {
    const broken = createDb(TEST_DATABASE_URL);
    await broken.close();
    const { engine, addPlayer } = makeEngine();
    addPlayer(a);
    const fatal: unknown[] = [];
    const runtime = new GameRuntime(engine, broken.db, { seasonId: 1, now: () => clock, flushIntervalMs: 0, onFatal: (e) => fatal.push(e) });

    await expect(runtime.run((e, now) => e.placePixel(a, pixel(1, 1), now))).rejects.toThrow();
    expect(fatal).toHaveLength(1);
    await expect(runtime.run((e, now) => e.placePixel(a, pixel(2, 1), now))).rejects.toThrow("stopped");
    expect(fatal).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/persistence/runtime.test.ts`
Expected: FAIL — `Cannot find module './runtime'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/persistence/runtime.ts`:
```ts
import { CHUNK_SIZE } from "@rave/shared";
import type { Db } from "../db/client";
import type { GameEngine } from "../engine/engine";
import { createPlayer, type NewPlayer } from "../engine/player";
import type { PlayerState, UserId } from "../engine/types";
import { snapshotPlayer, type Batch, type ChunkSnapshot } from "./batch";
import { writeBatch } from "./write-batch";

export interface RuntimeOptions {
  seasonId: number;
  /** Group-commit window. Default 100 ms. */
  flushIntervalMs?: number;
  /** How often dirty chunks are snapshotted. Default 5 min. */
  snapshotIntervalMs?: number;
  now?: () => number;
  /** Called once when a commit fails. Default: log and exit (fail-fast, Docker restarts us). */
  onFatal?: (error: unknown) => void;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

function exitProcess(error: unknown): void {
  console.error("Fatal: failed to persist game state", error);
  process.exit(1);
}

/**
 * Runs engine commands and persists their effects with group commit.
 * A command's promise resolves only after the batch containing its effects is committed.
 */
export class GameRuntime {
  private waiters: Waiter[] = [];
  private newPlayers: Batch["newPlayers"] = [];
  private dirtyChunks = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private lastSnapshotAt: number;
  private readonly seasonId: number;
  private readonly flushIntervalMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly now: () => number;
  private readonly onFatal: (error: unknown) => void;

  constructor(
    readonly engine: GameEngine,
    private db: Db,
    options: RuntimeOptions,
  ) {
    this.seasonId = options.seasonId;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 300_000;
    this.now = options.now ?? Date.now;
    this.onFatal = options.onFatal ?? exitProcess;
    this.lastSnapshotAt = this.now();
  }

  /** Executes `command` right away; resolves with its result once its effects are committed. */
  run<T>(command: (engine: GameEngine, now: number) => T): Promise<T> {
    if (this.failed) return Promise.reject(this.stoppedError());
    const result = command(this.engine, this.now());
    return this.afterCommit().then(() => result);
  }

  /** Creates a player (caller checks it does not exist yet); resolves once it is persisted. */
  addPlayer(init: Omit<NewPlayer, "now">): Promise<PlayerState> {
    if (this.failed) return Promise.reject(this.stoppedError());
    const now = this.now();
    const player = createPlayer({ ...init, now }, this.engine.config);
    this.engine.players.add(player);
    this.newPlayers.push({ player: snapshotPlayer(player), at: now });
    return this.afterCommit().then(() => player);
  }

  /** Commits everything produced so far. `snapshot: true` also snapshots dirty chunks (shutdown, tests). */
  flush(options: { snapshot?: boolean } = {}): Promise<void> {
    this.queue = this.queue.then(() => this.commit(options.snapshot ?? false));
    return this.queue;
  }

  private stoppedError(): Error {
    return new Error("Game runtime stopped after a persistence failure");
  }

  private afterCommit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private async commit(forceSnapshot: boolean): Promise<void> {
    if (this.failed) return;
    const waiters = this.waiters;
    this.waiters = [];
    const batch = this.takeBatch(forceSnapshot);
    if (batch) {
      try {
        await this.db.transaction((tx) => writeBatch(tx, batch));
      } catch (error) {
        this.failed = true;
        for (const w of waiters) w.reject(error);
        this.onFatal(error);
        return;
      }
    }
    for (const w of waiters) w.resolve();
  }

  /** Drains everything synchronously, so events, player snapshots and chunk copies are one consistent cut. */
  private takeBatch(forceSnapshot: boolean): Batch | null {
    const events = this.engine.drainEvents();
    const newPlayers = this.newPlayers;
    this.newPlayers = [];

    const touched = new Set<UserId>();
    for (const e of events) {
      if (e.type === "player") touched.add(e.userId);
      else if (e.type === "pixel") this.dirtyChunks.add(`${Math.floor(e.x / CHUNK_SIZE)}:${Math.floor(e.y / CHUNK_SIZE)}`);
    }

    const now = this.now();
    const snapshotDue = forceSnapshot || now - this.lastSnapshotAt >= this.snapshotIntervalMs;
    const chunks = snapshotDue ? this.takeDirtyChunks() : [];
    if (snapshotDue) this.lastSnapshotAt = now;

    if (events.length === 0 && newPlayers.length === 0 && chunks.length === 0) return null;
    const players = [...touched].map((id) => snapshotPlayer(this.engine.players.get(id)));
    return { seasonId: this.seasonId, events, players, newPlayers, chunks };
  }

  private takeDirtyChunks(): ChunkSnapshot[] {
    const chunks: ChunkSnapshot[] = [];
    for (const key of this.dirtyChunks) {
      const [cx, cy] = key.split(":").map(Number) as [number, number];
      const chunk = this.engine.canvas.getChunk(cx, cy);
      if (chunk) chunks.push({ cx, cy, colors: chunk.colors.slice(), owners: chunk.owners.slice() });
    }
    this.dirtyChunks.clear();
    return chunks;
  }
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/persistence/runtime.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(persistence): add group-commit game runtime"
```

---

### Task 8: Сквозные тесты перезапуска

**Files:**
- Test: `apps/server/src/persistence/restart.test.ts`

Код не меняется — тесты подтверждают, что связка `GameRuntime` → Postgres → `loadGame` восстанавливает ровно то же состояние. Если какой-то тест падает, это баг в Task 5–7: исправить там, не меняя ожиданий теста.

- [ ] **Step 1: Написать тесты**

`apps/server/src/persistence/restart.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { chunkSnapshots, statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import type { GameEngine } from "../engine/engine";
import { T0 } from "../engine/test-utils";
import type { PlayerState } from "../engine/types";
import { PERMANENT_BAN_DATE } from "./codec";
import { loadGame } from "./load-game";
import { GameRuntime } from "./runtime";

const t = createTestDb();
let clock = T0;
let a = 0;
let b = 0;

beforeEach(async () => {
  await t.reset();
  clock = T0;
  a = await insertUser(t.db, "a");
  b = await insertUser(t.db, "b");
});
afterAll(() => t.close());

async function boot() {
  const { engine, seasonId } = await loadGame(t.db, clock);
  const runtime = new GameRuntime(engine, t.db, { seasonId, now: () => clock, flushIntervalMs: 0, onFatal: () => {} });
  return { engine, runtime };
}

async function bootWithPlayers() {
  const booted = await boot();
  for (const userId of [a, b]) {
    // Same value insertUser() stores in users.discord_created_at, so reloaded players compare equal.
    await booted.runtime.addPlayer({ userId, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
  }
  return booted;
}

const comparable = (p: PlayerState) => ({ ...p, unlockedColors: [...p.unlockedColors].sort() });
const place = (x: number, y: number, colorId = 3, withBomb = false) => ({ x, y, colorId, withBomb });

describe("restart", () => {
  test("players, canvas and bombs survive a restart", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    await run((e, now) => e.placePixel(a, place(5, 5, 3, true), now));
    await run((e, now) => e.placePixel(a, place(7, 7, 6, true), now));
    await run((e, now) => e.placePixel(a, place(300, 10, 4), now));
    await run((e, now) => e.placePixel(b, place(5, 5, 9), now));
    await run((e, now) => e.buyItem(b, "bomb", now));
    await run((e, now) => e.claimDaily(a, now));

    const second = await boot();
    for (const [x, y] of [[5, 5], [7, 7], [300, 10]] as const) {
      expect(second.engine.canvas.get(x, y)).toEqual(first.engine.canvas.get(x, y));
    }
    expect(second.engine.canvas.territoryOf(a)).toBe(3);
    expect(second.engine.bombs.get(5, 5)).toBeUndefined();
    expect(second.engine.bombs.get(7, 7)?.ownerId).toBe(a);
    for (const id of [a, b]) {
      expect(comparable(second.engine.players.get(id))).toEqual(comparable(first.engine.players.get(id)));
    }
  });

  test("snapshot plus log replay restores every pixel", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [300, 300]] as const) {
      await run((e, now) => e.placePixel(a, place(x, y), now));
    }
    await first.runtime.flush({ snapshot: true });
    await run((e, now) => e.placePixel(a, place(0, 0, 7), now));
    await run((e, now) => e.placePixel(a, place(3, 0), now));
    await run((e, now) => e.placePixel(b, place(301, 300), now));

    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(2);
    const second = await boot();
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [3, 0], [300, 300], [301, 300]] as const) {
      expect(second.engine.canvas.get(x, y)).toEqual(first.engine.canvas.get(x, y));
    }
    expect(second.engine.canvas.get(0, 0)).toEqual({ colorId: 7, ownerId: a });
    expect(second.engine.canvas.territoryOf(a)).toBe(5);
    expect(second.engine.canvas.territoryOf(b)).toBe(1);
  });

  test("the anti-farm limit survives a restart", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    await run((e, now) => e.buyItem(a, "bomb", now));
    for (let x = 0; x < 4; x++) await run((e, now) => e.placePixel(a, place(x, 0, 3, true), now));
    for (let x = 0; x < 3; x++) {
      await run((e, now) => e.placePixel(b, place(x, 0, 9), now));
      clock += 60_000;
    }

    const second = await boot();
    const result = await second.runtime.run((e: GameEngine, now) => e.placePixel(b, place(3, 0, 9), now));
    expect(result.ok && result.outcome).toBe("exploded");
    const [stats] = await t.db.select().from(statsDaily).where(eq(statsDaily.userId, a));
    expect(stats?.bombsTriggered).toBe(3);
  });

  test("a permanent ban is loaded as Infinity and blocks play", async () => {
    await bootWithPlayers();
    await t.db.update(users).set({ bannedUntil: PERMANENT_BAN_DATE }).where(eq(users.id, a));
    const second = await boot();
    expect(second.engine.players.get(a).bannedUntil).toBe(Number.POSITIVE_INFINITY);
    const result = await second.runtime.run((e, now) => e.placePixel(a, place(1, 1), now));
    expect(result).toEqual({ ok: false, code: "banned" });
  });
});
```

- [ ] **Step 2: Запустить**

Run: `bun test apps/server/src/persistence/restart.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/persistence/restart.test.ts
git commit -m "test(persistence): verify state survives restarts"
```

---

### Task 9: Финальная проверка

- [ ] **Step 1: Все тесты**

Run: `bun test`
Expected: PASS, 0 fail. Итого 93 теста: 65 из Плана 1 + schema 2 + canvas-store 2 + codec 5 + write-batch 6 + load-game 4 + runtime 5 + restart 4.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Чистое дерево**

Run: `git status --short`
Expected: пустой вывод.
