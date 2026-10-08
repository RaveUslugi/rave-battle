# План 4b: рейтинги, профиль, TanStack Query, доводка 4a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** лидерборды (художники, бомберы, сапёры, камикадзе — день / 7 дней / всё время; территория — сейчас) и публичные профили с тепловой картой поставленных пикселей; клиентские запросы через TanStack Query; закрыты выбранные хвосты ревью 4a.

**Architecture:**
- Сервер: `StatsService` (новый модуль `apps/server/src/stats/`) — суммы `stats_daily` по диапазону дат и территория из памяти движка; полный отсортированный список на доску×период кешируется на 30 с (из него же — «моё место»). Профиль: счётчики, территория, активные бомбы (число), любимый цвет и тепловая карта из `pixel_events` (кеш 5 мин на игрока). tRPC `stats.leaderboard` / `stats.profile` — публичные **query** (GET, без побочных эффектов, под общим IP-лимитом `/trpc`).
- Забаненные (сейчас) не попадают в топы; их профиль открывается с пометкой.
- `PlayerView.access` — почему игрок «только смотрит»; клиент использует его в предпроверке, бейдже дейлика, магазине и дейлике.
- Клиент: `@tanstack/react-query` + `@trpc/tanstack-react-query` (один `trpcClient` на приложение); вкладки «Рейтинги» и «Профиль» в боковой панели; имена в ленте и рейтинге открывают профиль.

**Tech Stack:** Bun 1.3.6, drizzle 0.45.3 + postgres.js, tRPC 11.19.0, `@tanstack/react-query` 5.103.2, React 19.3, zustand 5, bun test.

---

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Размер топа | Топ-50 + строка «Вы: № N, значение», если игрока нет в топе |
| «Неделя» | Скользящие 7 суток: сегодня + 6 предыдущих по часовому поясу конфига |
| Профили | Публичные: счётчики, территория, активные бомбы (число), любимый цвет, дата регистрации, тепловая карта. Монеты и инвентарь — только в своём (берутся из `gameStore.player`, не с сервера) |
| Тепловая карта | Картинка в профиле: холст делится на блоки так, чтобы сторона ≤ 64 (для 512² — блоки 8×8); яркость — число поставленных пикселей; фон — тусклая миникарта. Период — всё время, кеш 5 мин |
| Баны | Забаненные сейчас скрыты из топов; профиль с пометкой «заблокирован» |
| Размещение | Вкладки 🏆 «Рейтинги» и 👤 «Профиль» в боковой панели; без входа видна только 🏆 (и профиль другого игрока по клику на имя) |
| Хвосты 4a | `aria-disabled` и ожидание WS-обновления в магазине/дейлике; игроки только для просмотра; автовыбор купленного цвета; `/overview`: `max-age=5` и валидация `decodeOverview` |

Доски и колонки `stats_daily`:

| Доска | Колонка | Периоды |
|---|---|---|
| `artists` — Художники | `pixels` | day / week / all |
| `bombers` — Бомберы | `bombs_triggered` (уже с анти-фармом) | day / week / all |
| `sappers` — Сапёры | `defused` | day / week / all |
| `kamikaze` — Камикадзе | `explosions_suffered` (только чужие бомбы) | day / week / all |
| `territory` — Территория | память движка | only `all` («сейчас») |

```
 stats_daily ──SUM by date range──┐
 engine.canvas territory ─────────┼─► StatsService (cache 30 s: full ranking per board×period)
 users.banned_until (filter) ─────┘        │
                                            ├─► tRPC stats.leaderboard {board, period} → top50 + me
 pixel_events (season, user) ──────────────►├─► tRPC stats.profile {userId} (heatmap/fav cache 5 min)
                                            ▼
 web: QueryClientProvider + TRPCProvider ─► LeadersTab / ProfileTab (+ Heatmap) ─► click name → profile
```

## Файлы

Сервер/общие:
- Modify `apps/server/src/persistence/runtime.ts` (геттер `season`), `apps/server/src/engine/canvas-store.ts` (`territories()`).
- Create `apps/server/src/stats/leaderboards.ts`, `leaderboards.test.ts`, `profiles.ts`, `profiles.test.ts`, `service.ts`.
- Modify `apps/server/src/net/deps.ts`, `apps/server/src/main.ts`, `apps/server/src/trpc/router.ts`, `router.test.ts`, `apps/server/src/net/server.test.ts`.
- Modify `packages/shared/src/protocol.ts` (`PlayerView.access`, `decodeOverview`), `packages/shared/src/protocol.overview.test.ts`, `apps/server/src/net/views.ts`, `views.test.ts`, `apps/server/src/net/server.ts` (overview headers).

Клиент:
- Modify `apps/web/package.json`, `bun.lock`; Create `apps/web/src/net/trpc.ts`; Modify `apps/web/src/net/api.ts`, `apps/web/src/main.tsx`.
- Modify `apps/web/src/state/ui-store.ts` (+test), `apps/web/src/ui/SidePanel.tsx`, `PanelMenu.tsx`.
- Create `apps/web/src/game/leaders.ts` (+test), `apps/web/src/ui/LeadersTab.tsx`; Create `apps/web/src/game/heatmap.ts` (+test), `apps/web/src/ui/ProfileTab.tsx`, `apps/web/src/ui/Heatmap.tsx`; Modify `apps/web/src/ui/Tabs.module.css`.
- Modify `apps/web/src/state/feed-store.ts` (+test), `apps/web/src/ui/Feed.tsx`.
- Modify `apps/web/src/game/placement.ts` (+test), `apps/web/src/ui/ShopTab.tsx`, `DailyTab.tsx`, `PanelMenu.tsx`, тестовые фикстуры `PlayerView`.
- Modify `docs/superpowers/plans/2026-10-07-00-roadmap.md`.

Проверки из корня: `bun test` (Postgres: `bun run db:up`), `bun run typecheck`, `bun run build:web`.

---

### Task 1: Рейтинги на сервере

**Files:** Modify `apps/server/src/persistence/runtime.ts`, `apps/server/src/engine/canvas-store.ts`; Create `apps/server/src/stats/leaderboards.ts`, `apps/server/src/stats/leaderboards.test.ts`

- [ ] **Step 1: Тест `leaderboards.test.ts`** (тестовая БД; данные пишем прямо в `stats_daily`, территорию — через движок):

```ts
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dateKey, DAY_MS } from "@rave/shared";
import { eq } from "drizzle-orm";
import { statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { Leaderboards } from "./leaderboards";

const t = createTestDb();
const NOW = Date.UTC(2026, 9, 8, 12); // 15:00 Moscow
const TZ = "Europe/Moscow";
let runtime: GameRuntime;
let ids: Record<string, number>;

beforeEach(async () => {
  await t.reset();
  ids = {};
  for (const name of ["ann", "ben", "cat", "dan"]) ids[name] = await insertUser(t.db, name);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

async function stat(name: string, daysAgo: number, values: Partial<typeof statsDaily.$inferInsert>) {
  await t.db.insert(statsDaily).values({ userId: ids[name]!, seasonId: runtime.season, date: dateKey(NOW - daysAgo * DAY_MS, TZ), ...values });
}

describe("Leaderboards", () => {
  test("sums by period, ranks with ties, skips zeros and reports my place", async () => {
    await stat("ann", 0, { pixels: 5 });
    await stat("ann", 3, { pixels: 10 });
    await stat("ben", 0, { pixels: 7 });
    await stat("cat", 10, { pixels: 50 });
    await stat("dan", 0, { pixels: 7, defused: 1 });
    const boards = new Leaderboards(t.db, runtime, () => NOW);

    const day = await boards.ranking("artists", "day");
    expect(day.map((r) => [r.userId, r.value, r.rank])).toEqual([
      [ids.ben, 7, 1],
      [ids.dan, 7, 1],
      [ids.ann, 5, 3],
    ]);
    const week = await boards.ranking("artists", "week");
    expect(week.map((r) => [r.userId, r.value])).toEqual([[ids.ann, 15], [ids.ben, 7], [ids.dan, 7]]);
    const all = await boards.ranking("artists", "all");
    expect(all[0]).toMatchObject({ userId: ids.cat, value: 50, rank: 1 });
    expect((await boards.ranking("sappers", "all")).map((r) => r.userId)).toEqual([ids.dan]);
  });

  test("the ranking is cached for 30 s", async () => {
    let now = NOW;
    const boards = new Leaderboards(t.db, runtime, () => now);
    await stat("ann", 0, { pixels: 1 });
    expect(await boards.ranking("artists", "all")).toHaveLength(1);
    await stat("ben", 0, { pixels: 2 });
    expect(await boards.ranking("artists", "all")).toHaveLength(1);
    now += 30_000;
    expect(await boards.ranking("artists", "all")).toHaveLength(2);
  });

  test("currently banned players are hidden; expired bans are not", async () => {
    await stat("ann", 0, { pixels: 1 });
    await stat("ben", 0, { pixels: 2 });
    await t.db.update(users).set({ bannedUntil: new Date(NOW + DAY_MS) }).where(eq(users.id, ids.ben!));
    await t.db.update(users).set({ bannedUntil: new Date(NOW - DAY_MS) }).where(eq(users.id, ids.ann!));
    const boards = new Leaderboards(t.db, runtime, () => NOW);
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ann]);
  });

  test("territory comes from the canvas in memory and ignores the period", async () => {
    for (const name of ["ann", "ben"]) {
      await runtime.addPlayer({ userId: ids[name]!, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    }
    await runtime.run((engine, now) => {
      engine.placePixel(ids.ann!, { x: 1, y: 1, colorId: 3, withBomb: false }, now);
      engine.placePixel(ids.ann!, { x: 2, y: 1, colorId: 3, withBomb: false }, now);
      engine.placePixel(ids.ben!, { x: 3, y: 1, colorId: 3, withBomb: false }, now);
    });
    const boards = new Leaderboards(t.db, runtime, () => NOW);
    const ranking = await boards.ranking("territory", "day");
    expect(ranking.map((r) => [r.userId, r.value])).toEqual([[ids.ann, 2], [ids.ben, 1]]);
  });
});
```

(`insertUser` создаёт пользователей с `banned_until = null`. Бан для территории проверяется по `engine.players` — у игроков, загруженных в движок, `bannedUntil` уже есть; отдельного теста не нужно, логика общая — см. Step 3.)

- [ ] **Step 2:** `bun test apps/server/src/stats` → FAIL (модуля нет).

- [ ] **Step 3: Реализация.**

`runtime.ts` — публичный геттер рядом с конструктором:

```ts
  /** Season all game state belongs to. */
  get season(): number {
    return this.seasonId;
  }
```

`canvas-store.ts`:

```ts
  /** Cells owned per user (only users with at least one cell). */
  territories(): IterableIterator<[UserId, number]> {
    return this.territory.entries();
  }
```

`stats/leaderboards.ts`:

```ts
import { DAY_MS, dateKey } from "@rave/shared";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { statsDaily, users } from "../db/schema";
import type { GameRuntime } from "../persistence/runtime";

export const BOARDS = ["artists", "bombers", "sappers", "kamikaze", "territory"] as const;
export type Board = (typeof BOARDS)[number];
export const PERIODS = ["day", "week", "all"] as const;
export type Period = (typeof PERIODS)[number];

export interface Ranked {
  userId: number;
  value: number;
  /** Competition ranking: equal values share a rank (1, 2, 2, 4). */
  rank: number;
}

const COLUMNS = {
  artists: statsDaily.pixels,
  bombers: statsDaily.bombsTriggered,
  sappers: statsDaily.defused,
  kamikaze: statsDaily.explosionsSuffered,
} as const;

const CACHE_MS = 30_000;

/** Ranks by value, then user id for a stable order. */
function rank(rows: Array<{ userId: number; value: number }>): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.userId - b.userId);
  let prev: { value: number; rank: number } | null = null;
  return sorted.map((r, i) => {
    const rank = prev && prev.value === r.value ? prev.rank : i + 1;
    prev = { value: r.value, rank };
    return { ...r, rank };
  });
}

/** Full rankings per board × period, recomputed at most every 30 s (spec 4: "топы кэшируются в памяти"). */
export class Leaderboards {
  private cache = new Map<string, { at: number; ranking: Promise<Ranked[]> }>();

  constructor(
    private readonly db: Db,
    private readonly runtime: GameRuntime,
    private readonly now: () => number = Date.now,
  ) {}

  ranking(board: Board, period: Period): Promise<Ranked[]> {
    // Territory is "right now": one ranking for every period.
    const key = board === "territory" ? "territory" : `${board}:${period}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.ranking;
    const ranking = board === "territory" ? Promise.resolve(this.territory(now)) : this.fromStats(board, period, now);
    // A failed query must not stay cached.
    ranking.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: now, ranking });
    return ranking;
  }

  private async fromStats(board: Exclude<Board, "territory">, period: Period, now: number): Promise<Ranked[]> {
    const column = COLUMNS[board];
    const tz = this.runtime.engine.config.daily.timezone;
    const from = period === "day" ? dateKey(now, tz) : period === "week" ? dateKey(now - 6 * DAY_MS, tz) : null;
    const total = sql<number>`sum(${column})::int`;
    const rows = await this.db
      .select({ userId: statsDaily.userId, value: total })
      .from(statsDaily)
      .innerJoin(users, eq(users.id, statsDaily.userId))
      .where(
        and(
          eq(statsDaily.seasonId, this.runtime.season),
          from === null ? undefined : gte(statsDaily.date, from),
          or(isNull(users.bannedUntil), lte(users.bannedUntil, new Date(now))),
        ),
      )
      .groupBy(statsDaily.userId)
      .having(sql`sum(${column}) > 0`)
      .orderBy(desc(total), asc(statsDaily.userId));
    return rank(rows);
  }

  private territory(now: number): Ranked[] {
    const players = this.runtime.engine.players;
    const rows: Array<{ userId: number; value: number }> = [];
    for (const [userId, value] of this.runtime.engine.canvas.territories()) {
      if (userId === 0) continue;
      const banned = players.has(userId) && (players.get(userId).bannedUntil ?? 0) > now;
      if (!banned) rows.push({ userId, value });
    }
    return rank(rows);
  }
}
```

(`dateKey` даёт `YYYY-MM-DD`, такие строки сравниваются лексикографически так же, как даты. Если владелец 0 «никто» не хранится в `territory` — проверка безвредна.)

- [ ] **Step 4:** `bun test apps/server && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/stats apps/server/src/persistence/runtime.ts apps/server/src/engine/canvas-store.ts
git commit -m "feat(server): rank players by stats and territory with a 30 s cache"
```

---

### Task 2: Профиль на сервере

**Files:** Create `apps/server/src/stats/profiles.ts`, `apps/server/src/stats/profiles.test.ts`

- [ ] **Step 1: Тест `profiles.test.ts`**

```ts
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dateKey, DAY_MS } from "@rave/shared";
import { eq } from "drizzle-orm";
import { statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { Profiles } from "./profiles";

const t = createTestDb();
let runtime: GameRuntime;
let ann: number;
let ben: number;

beforeEach(async () => {
  await t.reset();
  ann = await insertUser(t.db, "ann");
  ben = await insertUser(t.db, "ben");
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  for (const id of [ann, ben]) await runtime.addPlayer({ userId: id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const profiles = async (now = Date.now) => new Profiles(t.db, runtime, await UserDirectory.load(t.db), now);

describe("Profiles", () => {
  test("totals, territory, active bombs, favorite color and the heatmap", async () => {
    await runtime.run((engine, now) => {
      engine.placePixel(ann, { x: 1, y: 1, colorId: 5, withBomb: false }, now);
      engine.placePixel(ann, { x: 2, y: 1, colorId: 5, withBomb: true }, now);
      engine.placePixel(ann, { x: 300, y: 9, colorId: 7, withBomb: false }, now);
    });
    const tz = runtime.engine.config.daily.timezone;
    await t.db.insert(statsDaily).values({ userId: ann, seasonId: runtime.season, date: dateKey(Date.now() - 2 * DAY_MS, tz), pixels: 4, selfExplosions: 1 });

    const p = (await (await profiles()).profile(ann))!;
    expect(p.user).toEqual({ id: ann, name: "ann" });
    expect(p.totals).toMatchObject({ pixels: 7, selfExplosions: 1, bombsTriggered: 0 });
    expect(p.territory).toBe(3);
    expect(p.activeBombs).toBe(1);
    expect(p.favoriteColor).toBe(5);
    expect(p.banned).toBe(false);
    expect(p.heatmap).toMatchObject({ step: 8, width: 64, height: 64 });
    // (1,1) and (2,1) share block 0; (300,9) is block x=37, y=1.
    expect(p.heatmap.cells.sort((a, b) => a[0] - b[0])).toEqual([[0, 2], [1 * 64 + 37, 1]]);
  });

  test("a user without activity gets zeros; unknown users get null", async () => {
    const p = (await (await profiles()).profile(ben))!;
    expect(p).toMatchObject({ territory: 0, activeBombs: 0, favoriteColor: null, totals: { pixels: 0 } });
    expect(p.heatmap.cells).toEqual([]);
    expect(await (await profiles()).profile(9999)).toBeNull();
  });

  test("banned users are marked; the pixel aggregates are cached for 5 minutes", async () => {
    let now = Date.now();
    const service = await profiles(() => now);
    await t.db.update(users).set({ bannedUntil: new Date(now + DAY_MS) }).where(eq(users.id, ben));
    expect((await service.profile(ben))!.banned).toBe(true);
    await runtime.run((engine, at) => engine.placePixel(ben, { x: 0, y: 0, colorId: 9, withBomb: false }, at));
    expect((await service.profile(ben))!.favoriteColor).toBeNull();
    now += 5 * 60_000;
    expect((await service.profile(ben))!.favoriteColor).toBe(9);
  });
});
```

(Бан проверяется в БД, а `placePixel` для `ben` пройдёт, потому что игрок в движке не забанен — тест про кеш, а не про бан. `runtime.run()` резолвится после коммита, поэтому `pixel_events` и `stats_daily` уже записаны.)

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `stats/profiles.ts`**

```ts
import type { UserRef } from "@rave/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pixelEvents, statsDaily, users } from "../db/schema";
import type { UserDirectory } from "../net/user-directory";
import type { GameRuntime } from "../persistence/runtime";

/** Longest heatmap side in blocks. */
export const HEATMAP_MAX_SIDE = 64;
const PIXEL_CACHE_MS = 5 * 60_000;
const PIXEL_CACHE_SIZE = 1_000;

export interface Heatmap {
  /** Canvas cells per block side. */
  step: number;
  width: number;
  height: number;
  /** Sparse [blockIndex, placedPixels]; blockIndex = by * width + bx. */
  cells: Array<[number, number]>;
}

export interface Profile {
  user: UserRef;
  joinedAt: number;
  banned: boolean;
  totals: { pixels: number; bombsTriggered: number; defused: number; explosionsSuffered: number; selfExplosions: number };
  territory: number;
  activeBombs: number;
  favoriteColor: number | null;
  heatmap: Heatmap;
}

type PixelAggregates = Pick<Profile, "favoriteColor" | "heatmap">;

/** Public player profiles. Never exposes coins, inventory or bomb positions. */
export class Profiles {
  private pixelCache = new Map<number, { at: number; data: Promise<PixelAggregates> }>();

  constructor(
    private readonly db: Db,
    private readonly runtime: GameRuntime,
    private readonly users: UserDirectory,
    private readonly now: () => number = Date.now,
  ) {}

  async profile(userId: number): Promise<Profile | null> {
    const [user] = await this.db
      .select({ createdAt: users.createdAt, bannedUntil: users.bannedUntil })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return null;
    const season = this.runtime.season;
    const [totals] = await this.db
      .select({
        pixels: sql<number>`coalesce(sum(${statsDaily.pixels}), 0)::int`,
        bombsTriggered: sql<number>`coalesce(sum(${statsDaily.bombsTriggered}), 0)::int`,
        defused: sql<number>`coalesce(sum(${statsDaily.defused}), 0)::int`,
        explosionsSuffered: sql<number>`coalesce(sum(${statsDaily.explosionsSuffered}), 0)::int`,
        selfExplosions: sql<number>`coalesce(sum(${statsDaily.selfExplosions}), 0)::int`,
      })
      .from(statsDaily)
      .where(and(eq(statsDaily.userId, userId), eq(statsDaily.seasonId, season)));
    const engine = this.runtime.engine;
    return {
      user: this.users.ref(userId),
      joinedAt: user.createdAt.getTime(),
      banned: user.bannedUntil !== null && user.bannedUntil.getTime() > this.now(),
      totals: totals!,
      territory: engine.canvas.territoryOf(userId),
      activeBombs: engine.bombs.activeCount(userId),
      ...(await this.pixels(userId)),
    };
  }

  private pixels(userId: number): Promise<PixelAggregates> {
    const now = this.now();
    const hit = this.pixelCache.get(userId);
    if (hit && now - hit.at < PIXEL_CACHE_MS) return hit.data;
    const data = this.loadPixels(userId);
    data.catch(() => this.pixelCache.delete(userId));
    this.pixelCache.delete(userId);
    this.pixelCache.set(userId, { at: now, data });
    // Map keeps insertion order: drop the oldest entries beyond the cap.
    for (const key of this.pixelCache.keys()) {
      if (this.pixelCache.size <= PIXEL_CACHE_SIZE) break;
      this.pixelCache.delete(key);
    }
    return data;
  }

  /** Both aggregates use the (season_id, user_id, created_at) index. */
  private async loadPixels(userId: number): Promise<PixelAggregates> {
    const { width: cw, height: ch } = this.runtime.engine.config.canvas;
    const step = Math.max(1, Math.ceil(Math.max(cw, ch) / HEATMAP_MAX_SIDE));
    const width = Math.ceil(cw / step);
    const height = Math.ceil(ch / step);
    const own = and(eq(pixelEvents.seasonId, this.runtime.season), eq(pixelEvents.userId, userId), eq(pixelEvents.kind, "place"));

    const [favorite] = await this.db
      .select({ colorId: pixelEvents.colorId, n: count() })
      .from(pixelEvents)
      .where(own)
      .groupBy(pixelEvents.colorId)
      .orderBy(desc(count()), pixelEvents.colorId)
      .limit(1);

    const block = sql<number>`(${pixelEvents.y} / ${step}) * ${width} + (${pixelEvents.x} / ${step})`;
    const blocks = await this.db.select({ block, n: count() }).from(pixelEvents).where(own).groupBy(block);

    return {
      favoriteColor: favorite?.colorId ?? null,
      heatmap: { step, width, height, cells: blocks.map((b) => [Number(b.block), b.n] as [number, number]) },
    };
  }
}
```

(Целочисленное деление `x / step` в Postgres — для `integer`, колонки `x`, `y` целые. `count()` в drizzle 0.45 возвращает number; если вернёт строку — обернуть `Number`. Если drizzle не даст `groupBy` по SQL-выражению — использовать `groupBy(sql\`1\`)` с позиционным номером или `sql` с алиасом; проверить, что запрос сформирован верно, через тест.)

- [ ] **Step 4:** `bun test apps/server && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/stats
git commit -m "feat(server): public player profiles with a pixel heatmap"
```

---

### Task 3: tRPC `stats.*` и подключение

**Files:** Create `apps/server/src/stats/service.ts`; Modify `apps/server/src/net/deps.ts`, `apps/server/src/main.ts`, `apps/server/src/trpc/router.ts`, `apps/server/src/trpc/router.test.ts`, `apps/server/src/net/server.test.ts` (и любые другие места, где собирается `AppDeps`: `grep -rn "hub: new Hub\|AppDeps = {" apps/server/src`)

- [ ] **Step 1: Тесты** в `router.test.ts` (в `beforeEach` добавить `stats: new StatsService(t.db, runtime, users)` в `deps`):

```ts
  test("leaderboards return the top and the caller's place; anonymous callers get no place", async () => {
    await runtime.addPlayer({ userId: alice.id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(alice.id, { x: 1, y: 1, colorId: 3, withBomb: false }, now));
    const board = await as(alice).stats.leaderboard({ board: "artists", period: "all" });
    expect(board.top).toEqual([{ rank: 1, user: { id: alice.id, name: "alice" }, value: 1 }]);
    expect(board.me).toEqual({ rank: 1, value: 1 });
    expect((await as(bob).stats.leaderboard({ board: "artists", period: "all" })).me).toBeNull();
    expect((await as(null).stats.leaderboard({ board: "territory", period: "day" })).top[0]?.value).toBe(1);
  });

  test("profiles are public and unknown ids are NOT_FOUND", async () => {
    expect((await as(null).stats.profile({ userId: alice.id })).user.name).toBe("alice");
    await expect(as(null).stats.profile({ userId: 99999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as(null).stats.leaderboard({ board: "nope" as never, period: "all" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
```

(`placePixel` пишет статистику через событие `stat` при коммите; `run` резолвится после коммита — `stats_daily` уже заполнена.)

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.**

`stats/service.ts`:

```ts
import type { Db } from "../db/client";
import type { UserDirectory } from "../net/user-directory";
import type { GameRuntime } from "../persistence/runtime";
import { Leaderboards } from "./leaderboards";
import { Profiles } from "./profiles";

/** Read-only statistics for the meta UI. */
export class StatsService {
  readonly leaderboards: Leaderboards;
  readonly profiles: Profiles;

  constructor(db: Db, runtime: GameRuntime, users: UserDirectory, now: () => number = Date.now) {
    this.leaderboards = new Leaderboards(db, runtime, now);
    this.profiles = new Profiles(db, runtime, users, now);
  }
}
```

`net/deps.ts` — поле `stats: StatsService;` (import type). `main.ts` — после создания `runtime` и `users`: `const stats = new StatsService(db, runtime, users);` и передать в `startServer({ …, stats })`. Обновить все места сборки `AppDeps` в тестах.

`trpc/router.ts`:

```ts
import { BOARDS, PERIODS } from "../stats/leaderboards";

const TOP = 50;

// внутри appRouter:
  stats: router({
    leaderboard: publicProcedure
      .input(z.object({ board: z.enum(BOARDS), period: z.enum(PERIODS) }))
      .query(async ({ ctx, input }) => {
        const ranking = await ctx.deps.stats.leaderboards.ranking(input.board, input.period);
        const mine = ctx.user ? ranking.find((r) => r.userId === ctx.user!.id) : undefined;
        return {
          top: ranking.slice(0, TOP).map((r) => ({ rank: r.rank, user: ctx.deps.users.ref(r.userId), value: r.value })),
          me: mine ? { rank: mine.rank, value: mine.value } : null,
        };
      }),
    profile: publicProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const profile = await ctx.deps.stats.profiles.profile(input.userId);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND" });
      return profile;
    }),
  }),
```

(`TRPCError` — из `@trpc/server`. Это `query`: по GET без Origin-проверки, ничего не создаёт и не меняет — так и должно быть, см. комментарий в `init.ts` про `playerProcedure`.)

- [ ] **Step 4:** `bun test apps/server && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): leaderboard and profile queries over tRPC"
```

---

### Task 4: `PlayerView.access` и игроки «только для просмотра»

**Files:** Modify `packages/shared/src/protocol.ts`, `apps/server/src/net/views.ts`, `views.test.ts`, `apps/web/src/game/placement.ts`, `placement.test.ts`, веб-фикстуры `PlayerView` (`client.test.ts`, `tools.test.ts`, …), `apps/web/src/ui/PanelMenu.tsx`

- [ ] **Step 1: Тесты.** `views.test.ts`:

```ts
  test("reports why a player may only watch", () => {
    const { cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    expect(toPlayerView(p, cfg, T0, false).access).toBe("ok");
    p.guildMember = false;
    expect(toPlayerView(p, cfg, T0, false).access).toBe("not_guild_member");
    p.bannedUntil = T0 + 1;
    expect(toPlayerView(p, cfg, T0, false).access).toBe("banned");
  });
```

`placement.test.ts`:

```ts
  test("players who may only watch are refused with the reason", () => {
    expect(planPlacement(input({ player: player({ access: "account_too_new" }) }))).toEqual({ ok: false, code: "account_too_new" });
  });
```

Все веб-фикстуры `player()` получают `access: "ok",` (typecheck их найдёт).

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.** `protocol.ts`, в `PlayerView`:

```ts
  /** "ok", or why the player may only watch (ban, not in the guild, account too new). Freeze is separate. */
  access: "ok" | "banned" | "not_guild_member" | "account_too_new";
```

`views.ts`: `access: (accessError(p, cfg, now) ?? "ok") as PlayerView["access"],` (импорт `accessError` из `../engine/access`; приведение нужно, потому что `RejectCode` шире — `accessError` возвращает только эти три кода).

`placement.ts` — первой проверкой после `if (!p) …`: `if (p.access !== "ok") return { ok: false, code: p.access };` (существующую проверку `bannedUntil` оставить — она покрывает старое поле и время).

`PanelMenu.tsx`: `const dailyReady = player.access === "ok" && !dailyState(…).claimedToday;`.

- [ ] **Step 4:** `bun test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts apps/server/src/net apps/web/src
git commit -m "feat: tell the client why a player may only watch"
```

---

### Task 5: `/overview` — `max-age=5` и строгий `decodeOverview`

**Files:** Modify `packages/shared/src/protocol.ts`, `packages/shared/src/protocol.overview.test.ts`, `apps/server/src/net/server.ts`, `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тесты.** `protocol.overview.test.ts`:

```ts
  test("rejects zero step and sides beyond the maximum", () => {
    expect(decodeOverview(encodeOverview({ step: 0, width: 1, height: 1, colors: new Uint8Array(1) }))).toBeNull();
    expect(decodeOverview(encodeOverview({ step: 1, width: 0, height: 0, colors: new Uint8Array(0) }))).toBeNull();
    const big = 257;
    expect(decodeOverview(encodeOverview({ step: 1, width: big, height: 1, colors: new Uint8Array(big) }))).toBeNull();
  });
```

`server.test.ts`, в тест «overview returns the sampled canvas»: `expect(res.headers.get("cache-control")).toBe("public, max-age=5");` (сохранить `res` в переменную).

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** `decodeOverview` — после чтения полей: `if (step < 1 || width < 1 || height < 1 || width > OVERVIEW_MAX_SIDE || height > OVERVIEW_MAX_SIDE) return null;`. `server.ts` `overviewResponse`: `"Cache-Control": "public, max-age=5"` (сервер и так пересобирает не чаще раза в 5 с; браузер и прокси могут не спрашивать повторно).

- [ ] **Step 4:** `bun test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src apps/server/src/net
git commit -m "fix: cache the overview for 5 s and validate its header"
```

---

### Task 6: TanStack Query на клиенте

**Files:** Modify `apps/web/package.json`, `bun.lock`, `apps/web/src/net/api.ts`, `apps/web/src/main.tsx`; Create `apps/web/src/net/trpc.ts`

- [ ] **Step 1: Зависимости** (5.103.2 опубликована 2026-09-21; `@trpc/tanstack-react-query` 11.19.0 — 2026-09-16, совпадает с сервером):

```bash
bun add --cwd apps/web --exact @tanstack/react-query@5.103.2 @trpc/tanstack-react-query@11.19.0
```

- [ ] **Step 2: `net/trpc.ts`** — один клиент на приложение; `api.ts` переходит на него.

```ts
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server/src/trpc/router";

export const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc" })] });

export const queryClient = new QueryClient({
  // Game state arrives over the WebSocket; queries here are slow-changing stats.
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
```

`api.ts`: удалить локальный `createTRPCClient(...)` и импорт `httpBatchLink`; `import { trpcClient as trpc } from "./trpc";` (остальной код без изменений).

`main.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, trpcClient, TRPCProvider } from "./net/trpc";
// …
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
```

(Свериться с типами `createTRPCContext` в `node_modules/@trpc/tanstack-react-query` 11.19.0: пропсы провайдера — `trpcClient` и `queryClient`.)

- [ ] **Step 3:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS (тест `api.test.ts` должен остаться зелёным).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src
git commit -m "chore(web): add TanStack Query with a shared tRPC client"
```

---

### Task 7: Панель — вкладки «Рейтинги» и «Профиль», доступ без входа

**Files:** Modify `apps/web/src/state/ui-store.ts`, `ui-store.test.ts`, `apps/web/src/ui/SidePanel.tsx`, `apps/web/src/ui/PanelMenu.tsx`; Create `apps/web/src/ui/LeadersTab.tsx`, `apps/web/src/ui/ProfileTab.tsx` (заглушки, заменяются в Task 8–9)

- [ ] **Step 1: Тест** `ui-store.test.ts`:

```ts
  test("profiles open on a given player or on yourself", () => {
    const store = createUiStore(null);
    store.getState().openProfile(42);
    expect(store.getState()).toMatchObject({ panel: "profile", profileUserId: 42 });
    store.getState().openProfile(null);
    expect(store.getState()).toMatchObject({ panel: "profile", profileUserId: null });
    store.getState().openPanel("leaders");
    expect(store.getState().panel).toBe("leaders");
  });
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.**

`ui-store.ts`:

```ts
export type Panel = "shop" | "daily" | "leaders" | "profile";
// в UiState:
  /** Whose profile the profile tab shows; null = the logged-in player. */
  profileUserId: number | null;
  openProfile(userId: number | null): void;
// в createUiStore:
    profileUserId: null,
    openProfile: (profileUserId) => set({ panel: "profile", profileUserId }),
```

`togglePanel("profile")` с меню открывает свой профиль: в `PanelMenu` для 👤 вызывать `panel === "profile" && profileUserId === null ? closePanel() : openProfile(null)`.

`PanelMenu.tsx` — пункты:

```ts
const ITEMS: Array<{ panel: Panel; icon: string; label: string; needsLogin: boolean }> = [
  { panel: "shop", icon: "🛒", label: "Магазин", needsLogin: true },
  { panel: "daily", icon: "📅", label: "Дейлик", needsLogin: true },
  { panel: "leaders", icon: "🏆", label: "Рейтинги", needsLogin: false },
  { panel: "profile", icon: "👤", label: "Мой профиль", needsLogin: true },
];
```

Меню показывается всегда, когда есть `config`; пункты с `needsLogin` — только при `player`. Бейдж — как раньше (с учётом `access` из Task 4).

`SidePanel.tsx`:
- Вкладки: `shop`, `daily`, `profile` (свой) — только для вошедшего; `leaders` — всегда; `profile` с `profileUserId !== null` доступен и анониму. `TABS` фильтровать так же, как меню; заголовок вкладки профиля — «Профиль».
- `open = panel !== null && (user !== null || panel === "leaders" || (panel === "profile" && profileUserId !== null))`.
- Эффект «выход закрывает панель» закрывает только `shop`, `daily` и свой профиль (`profile` с `profileUserId === null`).
- Тело: `shop → <ShopTab />`, `daily → <DailyTab />`, `leaders → <LeadersTab />`, `profile → <ProfileTab />`.

Заглушки: `export function LeadersTab() { return <p>Рейтинги</p>; }`, `export function ProfileTab() { return <p>Профиль</p>; }`.

На 380 px четыре вкладки помещаются при `font-size: 14px` и `padding: 0 10px`; если нет — разрешить перенос (`flex-wrap: wrap`) в `.tabs` (`SidePanel.module.css`).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): leaderboard and profile tabs, open to visitors"
```

---

### Task 8: Вкладка «Рейтинги»

**Files:** Create `apps/web/src/game/leaders.ts`, `leaders.test.ts`; Replace `apps/web/src/ui/LeadersTab.tsx`; Modify `apps/web/src/ui/Tabs.module.css`

- [ ] **Step 1: Тест `leaders.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { BOARD_TABS, formatValue, periodsFor } from "./leaders";

describe("leaders", () => {
  test("territory has no period choice", () => {
    expect(periodsFor("territory")).toEqual([]);
    expect(periodsFor("artists").map((p) => p.period)).toEqual(["day", "week", "all"]);
  });

  test("tabs and values", () => {
    expect(BOARD_TABS.map((b) => b.board)).toEqual(["artists", "bombers", "sappers", "kamikaze", "territory"]);
    expect(formatValue(1234567)).toBe("1 234 567");
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `game/leaders.ts`**

```ts
export type Board = "artists" | "bombers" | "sappers" | "kamikaze" | "territory";
export type Period = "day" | "week" | "all";

export const BOARD_TABS: Array<{ board: Board; title: string; hint: string }> = [
  { board: "artists", title: "🎨 Художники", hint: "поставленные пиксели" },
  { board: "bombers", title: "💣 Бомберы", hint: "подрывы на ваших бомбах" },
  { board: "sappers", title: "🧯 Сапёры", hint: "обезвреженные чужие бомбы" },
  { board: "kamikaze", title: "💥 Камикадзе", hint: "подрывы на чужих бомбах" },
  { board: "territory", title: "🗺 Территория", hint: "клеток на холсте сейчас" },
];

const PERIODS: Array<{ period: Period; title: string }> = [
  { period: "day", title: "День" },
  { period: "week", title: "7 дней" },
  { period: "all", title: "Всё время" },
];

export function periodsFor(board: Board): typeof PERIODS {
  return board === "territory" ? [] : PERIODS;
}

/** Thin spaces between thousands, like the rest of the Russian UI. */
export function formatValue(n: number): string {
  return n.toLocaleString("ru-RU").replace(/\s/g, " ");
}
```

(Если `toLocaleString("ru-RU")` в Bun даёт другой разделитель — тест фиксирует обычный пробел; `replace` нормализует любой пробельный символ.)

`ui/LeadersTab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BOARD_TABS, formatValue, periodsFor, type Board, type Period } from "../game/leaders";
import { useTRPC } from "../net/trpc";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

/** Top 50 per board and period, refreshed every 30 s while open; the server caches rankings for as long. */
export function LeadersTab() {
  const trpc = useTRPC();
  const user = useGame((s) => s.user);
  const [board, setBoard] = useState<Board>("artists");
  const [period, setPeriod] = useState<Period>("day");
  const query = useQuery({ ...trpc.stats.leaderboard.queryOptions({ board, period }), refetchInterval: 30_000 });
  const tab = BOARD_TABS.find((b) => b.board === board)!;

  return (
    <div className={styles.tab}>
      <div className={styles.segments} role="group" aria-label="Рейтинг">
        {BOARD_TABS.map((b) => (
          <button key={b.board} type="button" className={b.board === board ? styles.segmentOn : styles.segment} aria-pressed={b.board === board} onClick={() => setBoard(b.board)}>
            {b.title}
          </button>
        ))}
      </div>
      {periodsFor(board).length > 0 && (
        <div className={styles.segments} role="group" aria-label="Период">
          {periodsFor(board).map((p) => (
            <button key={p.period} type="button" className={p.period === period ? styles.segmentOn : styles.segment} aria-pressed={p.period === period} onClick={() => setPeriod(p.period)}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      <p className={styles.hint}>{tab.hint}</p>
      {query.isPending && <p className={styles.hint}>Загрузка…</p>}
      {query.isError && <p className={styles.hint}>Не удалось загрузить рейтинг</p>}
      {query.data && query.data.top.length === 0 && <p className={styles.hint}>Пока никого</p>}
      {query.data && query.data.top.length > 0 && (
        <ol className={styles.ranking}>
          {query.data.top.map((row) => (
            <li key={row.user.id} className={row.user.id === user?.id ? styles.rankMe : styles.rank}>
              <span className={styles.place}>{row.rank}</span>
              <button type="button" className={styles.player} onClick={() => uiStore.getState().openProfile(row.user.id)}>
                {row.user.name}
              </button>
              <span className={styles.value}>{formatValue(row.value)}</span>
            </li>
          ))}
        </ol>
      )}
      {query.data?.me && !query.data.top.some((r) => r.user.id === user?.id) && (
        <p className={styles.mine}>
          Вы: № {query.data.me.rank}, {formatValue(query.data.me.value)}
        </p>
      )}
    </div>
  );
}
```

(Тип `Board`/`Period` клиента совпадает со схемой сервера по строкам; tRPC проверит это на typecheck: `queryOptions({ board, period })` примет только допустимые значения.)

`Tabs.module.css` — добавить:

```css
.segments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.segment,
.segmentOn {
  min-height: 36px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--panel-border);
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
}

.segmentOn {
  border-color: var(--neon-cyan);
  box-shadow: var(--glow-cyan);
}

.hint {
  margin: 0;
  font-size: 13px;
  opacity: 0.7;
}

.ranking {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.rank,
.rankMe {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 6px;
  border-radius: 8px;
}

.rankMe {
  background: rgba(34, 243, 255, 0.12);
}

.place {
  flex: none;
  width: 2.5em;
  text-align: right;
  opacity: 0.7;
}

.player {
  flex: 1;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
}

.player:hover,
.player:focus-visible {
  color: var(--neon-cyan);
  text-decoration: underline;
}

.value {
  flex: none;
}

.mine {
  margin: 4px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--panel-border);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): leaderboard tab with boards, periods and your place"
```

---

### Task 9: Вкладка «Профиль» и тепловая карта

**Files:** Create `apps/web/src/game/heatmap.ts`, `heatmap.test.ts`, `apps/web/src/ui/Heatmap.tsx`; Replace `apps/web/src/ui/ProfileTab.tsx`; Modify `apps/web/src/ui/Tabs.module.css`

- [ ] **Step 1: Тест `heatmap.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { heatColor, heatRects } from "./heatmap";

describe("heatmap", () => {
  test("rects scale blocks to the map and intensity is logarithmic", () => {
    const rects = heatRects({ step: 8, width: 64, height: 64, cells: [[0, 1], [65, 100]] }, { width: 128, height: 128, scale: 0.25 });
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    expect(rects[1]).toMatchObject({ x: 2, y: 2, w: 2, h: 2, t: 1 });
    expect(rects[0]!.t).toBeCloseTo(Math.log(2) / Math.log(101));
  });

  test("colors go from cyan to pink", () => {
    expect(heatColor(0)).toBe("rgba(34, 243, 255, 0.35)");
    expect(heatColor(1)).toBe("rgba(255, 43, 214, 1)");
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Реализация.**

`game/heatmap.ts`:

```ts
import type { MinimapLayout } from "../canvas/minimap-math";

export interface HeatmapData {
  step: number;
  width: number;
  height: number;
  cells: Array<[number, number]>;
}

/** One rectangle per non-empty block in map pixels; `t` = log-scaled intensity in [0, 1]. */
export function heatRects(h: HeatmapData, layout: MinimapLayout) {
  const max = Math.max(1, ...h.cells.map(([, n]) => n));
  const side = h.step * layout.scale;
  return h.cells.map(([index, n]) => ({
    x: (index % h.width) * side,
    y: Math.floor(index / h.width) * side,
    w: side,
    h: side,
    t: Math.log(1 + n) / Math.log(1 + max),
  }));
}

/** Neon cyan (cold) to pink (hot), more opaque when hotter. */
export function heatColor(t: number): string {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const alpha = Math.round((0.35 + 0.65 * t) * 100) / 100;
  return `rgba(${mix(34, 255)}, ${mix(243, 43)}, ${mix(255, 214)}, ${alpha})`;
}
```

`ui/Heatmap.tsx` — фон: тусклая миникарта (`fetchOverview` + палитра, `globalAlpha = 0.25`), сверху блоки:

```tsx
import { useEffect, useMemo, useRef } from "react";
import { fetchOverview } from "../canvas/chunk-loader";
import { minimapLayout } from "../canvas/minimap-math";
import { buildPaletteLut, paintRgba } from "../canvas/palette";
import { heatColor, heatRects, type HeatmapData } from "../game/heatmap";
import { useGame } from "../state/game-store";
import styles from "./Tabs.module.css";

const BOX = 240;

/** Where the player has painted, over a dimmed picture of the canvas. Pixels only — never bombs. */
export function Heatmap({ data }: { data: HeatmapData }) {
  const config = useGame((s) => s.config);
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => (config ? minimapLayout(config.canvas, BOX) : null), [config]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !layout || !config) return;
    const abort = new AbortController();
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(layout.width * dpr);
    el.height = Math.round(layout.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drawHeat = () => {
      for (const r of heatRects(data, layout)) {
        ctx.fillStyle = heatColor(r.t);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    };
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawHeat();
    fetchOverview(abort.signal)
      .then((o) => {
        const img = document.createElement("canvas");
        img.width = o.width;
        img.height = o.height;
        const ictx = img.getContext("2d");
        if (!ictx) return;
        const pixels = ictx.createImageData(o.width, o.height);
        paintRgba(o.colors, buildPaletteLut(config.palette), new Uint8Array(pixels.data.buffer));
        ictx.putImageData(pixels, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, layout.width, layout.height);
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.25;
        ctx.drawImage(img, 0, 0, layout.width, layout.height);
        ctx.globalAlpha = 1;
        drawHeat();
      })
      .catch(() => {
        // No background picture: the heat alone is still useful.
      });
    return () => abort.abort();
  }, [data, layout, config]);

  if (!layout) return null;
  return <canvas ref={ref} className={styles.heatmap} style={{ width: layout.width, height: layout.height }} role="img" aria-label="Тепловая карта поставленных пикселей" />;
}
```

`ui/ProfileTab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { formatValue } from "../game/leaders";
import { useTRPC } from "../net/trpc";
import { useGame } from "../state/game-store";
import { useUi } from "../state/ui-store";
import { Heatmap } from "./Heatmap";
import styles from "./Tabs.module.css";

/** Public counters of any player; coins and inventory only for yourself, from your live player state. */
export function ProfileTab() {
  const trpc = useTRPC();
  const me = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const target = useUi((s) => s.profileUserId) ?? me?.id ?? null;
  const query = useQuery({ ...trpc.stats.profile.queryOptions({ userId: target ?? 0 }), enabled: target !== null });

  if (target === null) return <p className={styles.hint}>Войдите, чтобы увидеть свой профиль</p>;
  if (query.isPending) return <p className={styles.hint}>Загрузка…</p>;
  if (query.isError) return <p className={styles.hint}>Профиль не найден</p>;
  const p = query.data;
  const own = p.user.id === me?.id;
  const favorite = p.favoriteColor === null ? null : config?.palette.find((e) => e.id === p.favoriteColor);
  const stats: Array<[string, number]> = [
    ["🎨 Пикселей", p.totals.pixels],
    ["🗺 Территория", p.territory],
    ["💣 Подрывов на моих бомбах", p.totals.bombsTriggered],
    ["🧯 Обезврежено", p.totals.defused],
    ["💥 Подрывов на чужих", p.totals.explosionsSuffered],
    ["🤦 Самоподрывов", p.totals.selfExplosions],
    ["⏳ Активных бомб", p.activeBombs],
  ];

  return (
    <div className={styles.tab}>
      <h3 className={styles.profileName}>
        {p.user.name}
        {own && <span className={styles.badgeMe}> · это вы</span>}
        {p.banned && <span className={styles.badgeBanned}> · заблокирован</span>}
      </h3>
      <p className={styles.hint}>В игре с {new Date(p.joinedAt).toLocaleDateString("ru-RU")}</p>
      {own && player && (
        <p className={styles.balance}>
          {player.coins} 🪙 · 💣 {player.inventory.bomb} · 🔍 {player.inventory.detector} · 🧯 {player.inventory.defuser}
        </p>
      )}
      <dl className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <dt>{label}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
        <div className={styles.stat}>
          <dt>❤ Любимый цвет</dt>
          <dd>{favorite ? <span className={styles.swatch} style={{ background: favorite.base }} aria-label={`Цвет ${favorite.id}`} /> : "—"}</dd>
        </div>
      </dl>
      <h3 className={styles.section}>Где рисует</h3>
      <Heatmap data={p.heatmap} />
    </div>
  );
}
```

(Для активных бомб показывается только число — спека 2.9 и раздел 8. Запрос со `userId: 0` при `enabled: false` не уходит.)

`Tabs.module.css` — добавить:

```css
.profileName {
  margin: 0;
  font-size: 18px;
  overflow-wrap: anywhere;
}

.badgeMe {
  color: var(--neon-cyan);
  font-size: 14px;
}

.badgeBanned {
  color: var(--danger);
  font-size: 14px;
}

.stats {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
}

.stat dt {
  font-size: 12px;
  opacity: 0.7;
}

.stat dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.heatmap {
  display: block;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): profile tab with counters and a heatmap"
```

---

### Task 10: Имена в ленте открывают профиль

**Files:** Modify `apps/web/src/state/feed-store.ts`, `feed-store.test.ts`, `apps/web/src/ui/Feed.tsx`, `Feed.module.css`

- [ ] **Step 1: Тест** — разбиение текста на части:

```ts
import { feedParts } from "./feed-store";

  test("parts keep names as user references", () => {
    expect(feedParts(entry("bob", "alice"))).toEqual(["💥 ", { id: 3, name: "bob" }, " подорвался на бомбе ", { id: 5, name: "alice" }]);
    const self = { ...entry("bob", "bob"), actor: { id: 3, name: "bob" }, owner: { id: 3, name: "bob" } };
    expect(feedParts(self)).toEqual(["💥 ", { id: 3, name: "bob" }, " подорвался на своей бомбе"]);
  });
```

(Хелпер `entry` в тесте берёт `id` = длина имени: bob → 3, alice → 5.)

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** `feed-store.ts`:

```ts
import type { UserRef } from "@rave/shared/client";

/** Feed text split into plain strings and player names (clickable in the UI). */
export function feedParts(e: FeedMessage): Array<string | UserRef> {
  const own = e.actor.id === e.owner.id;
  if (e.kind === "exploded") return own ? ["💥 ", e.actor, " подорвался на своей бомбе"] : ["💥 ", e.actor, " подорвался на бомбе ", e.owner];
  return own ? ["🧯 ", e.actor, " снял свою бомбу"] : ["🧯 ", e.actor, " обезвредил бомбу ", e.owner];
}

export function feedText(e: FeedMessage): string {
  return feedParts(e).map((p) => (typeof p === "string" ? p : p.name)).join("");
}
```

`Feed.tsx` — вместо `{feedText(e)}`:

```tsx
            {feedParts(e).map((part, i) =>
              typeof part === "string" ? (
                part
              ) : (
                <button key={i} type="button" className={styles.name} onClick={() => uiStore.getState().openProfile(part.id)}>
                  {part.name}
                </button>
              ),
            )}
```

`Feed.module.css`:

```css
.name {
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-decoration: underline dotted;
  cursor: pointer;
}

.name:hover,
.name:focus-visible {
  color: var(--neon-cyan);
}
```

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): names in the feed open player profiles"
```

---

### Task 11: Магазин и дейлик — фокус, ожидание обновления, только просмотр, автовыбор цвета

**Files:** Modify `apps/web/src/ui/ShopTab.tsx`, `apps/web/src/ui/DailyTab.tsx`, `apps/web/src/ui/Tabs.module.css`, `apps/web/src/game/messages.ts`

- [ ] **Step 1: `ShopTab.tsx`.**
  1. Недоступные строки (owned / maxed / не хватает монет) — **не** `disabled`, а `aria-disabled="true"`; `onBuy` в начале: `if (offerBlocked(offer)) return;`, где `offerBlocked = (o) => o.owned || (o.kind === "boost" && o.maxed) || !o.affordable`. Так фокус не уходит в `body`, когда строка становится недоступной после покупки.
  2. Ожидание WS-обновления: после `answer.ok` — `setWaiting(offer.key)`; `useEffect(() => setWaiting(null), [player])` (новая версия игрока пришла) и запасной таймер 3 с. Пока `waiting !== null` — все покупки ведут себя как при `busy` (`aria-disabled`, клик игнорируется). Это убирает ложный красный тост «уже открыт» при быстром втором клике.
  3. Автовыбор: при успешной покупке цвета — `uiStore.getState().selectColor(offer.colorId)`.
  4. Только просмотр: если `player.access !== "ok"` — вверху вкладки `<p className={styles.notice}>{rejectText(player.access)} — покупки недоступны</p>`, все кнопки `aria-disabled`, `onBuy` ничего не делает.

- [ ] **Step 2: `DailyTab.tsx`** — то же ожидание (`waiting` до смены `player` / 3 с) и тот же блок «только просмотр» (`… — награды недоступны`). Кнопка во всех недоступных состояниях (уже получено, ожидание, только просмотр) — `aria-disabled="true"` вместо `disabled`, а `claim` в начале проверяет эти условия и выходит: после нажатия кнопка в фокусе, и `disabled` выбросил бы фокус в `body`.

- [ ] **Step 3: CSS и тексты.** `Tabs.module.css`:

```css
.buy[aria-disabled="true"],
.armed[aria-disabled="true"],
.claim[aria-disabled="true"] {
  opacity: 0.45;
  box-shadow: none;
  cursor: default;
}

.notice {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--danger);
  border-radius: 10px;
  font-size: 13px;
}
```

`messages.ts`: `unauthorized` для панели звучит как «Войдите, чтобы рисовать» — добавить код `login_required: "Войдите, чтобы играть"` и использовать его в `PaletteBar` для закрытого покупаемого цвета у анонима (вместо `unauthorized`).

- [ ] **Step 4:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS. Компонентных тестов нет — проверка в Task 12.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): keep shop focus, wait for player updates, explain watch-only players, select bought colors"
```

---

### Task 12: Проверка целиком и roadmap

- [ ] **Step 1:** `bun test`, `bun run typecheck`, `bun run build:web` — числа в отчёт.

- [ ] **Step 2: Браузер** (два игрока: браузер + скрипт из прошлых планов или второй dev-логин):
  1. Аноним: в меню только 🏆; рейтинг открывается, клик по имени — профиль игрока; 🛒 📅 👤 не видны.
  2. Рейтинги: Художники / День → после нескольких пикселей игрок в топе (обновление ≤ 30 с); «7 дней», «Всё время»; Территория без переключателя периода; строка «Вы: № …» для игрока вне топа (проверить, например, на доске «Сапёры», где игрок с нулём не появляется — тогда строки нет).
  3. Профиль: свой (👤) — счётчики, территория, активные бомбы (число), любимый цвет, дата, монеты и инвентарь, тепловая карта поверх тусклой миникарты; чужой (клик по имени в ленте и в рейтинге) — без монет и инвентаря.
  4. Забаненный (`update users set banned_until = now() + interval '1 day'` для тестового пользователя, рестарт не нужен для рейтинга — до 30 с) пропадает из топа; его профиль с пометкой «заблокирован».
  5. Магазин: после покупки фокус остаётся на кнопке (Tab/Enter работают); быстрые повторные клики не дают красного тоста; купленный цвет выбран в палитре.
  6. Только просмотр: игрок с баном видит пометку в магазине и дейлике, бейджа на 📅 нет.
  7. `/overview` отдаёт `Cache-Control: public, max-age=5`.
  8. 375×812: четыре вкладки помещаются (или переносятся), рейтинг и профиль читаемы.

- [ ] **Step 3: Roadmap** — отметить 4b, перенести невыполненные заметки, добавить заметки финального ревью 4b.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-10-07-00-roadmap.md
git commit -m "docs: update the roadmap after plan 4b"
```

---

## Самопроверка плана

- Спека 2.9: 5 досок (художники, бомберы с анти-фармом через `bombs_triggered`, сапёры, камикадзе, территория «сейчас»), периоды день/неделя/всё время — Task 1, 3, 8; профиль (все счётчики, самоподрывы, активные бомбы без координат, любимый цвет, дата регистрации, тепловая карта пикселей, не бомб) — Task 2, 9. Раздел 4: топы в памяти, пересчёт ~30 с — Task 1.
- Безопасность (раздел 8): профиль не содержит координат бомб, монет и инвентаря; тепловая карта — только `pixel_events kind=place`. Запросы публичные read-only (`query`, GET), ничего не создают.
- Решения пользователя: топ-50 + своё место, скользящие 7 дней, публичные профили, картинка-тепловая карта за всё время с кешем, скрытие забаненных, вкладки в панели с 🏆 для анонима, четыре хвоста 4a — покрыты (Task 4, 5, 11).
- Зависимости: `StatsService` (Task 3) использует Task 1–2; `useTRPC` (Task 6) — в Task 8–9; заглушки вкладок (Task 7) заменяются в 8–9; `openProfile` (Task 7) — в Task 8, 10; `access` (Task 4) — в Task 11.
