# План 1: Фундамент и игровой движок — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Монорепо на bun workspaces с пакетом `@rave/shared` (zod-схема динамического конфига, дефолты, работа с датами) и чистым `GameEngine` в `apps/server`, реализующим все игровые правила спеки (раздел 2) и полностью покрытым тестами.

**Architecture:** `GameEngine` — единственный писатель игрового состояния, без I/O: принимает команду и `now` (мс), мутирует in-memory сторы (`CanvasStore`, `BombStore`, `PlayerRegistry`, `AntiFarm`) и складывает доменные события в outbox (`drainEvents()`), который в Плане 2 заберёт Persister. Заряды считаются лениво. Все числа — из `GameConfig`.

**Tech Stack:** Bun 1.3 (runtime, workspaces, `bun test`), TypeScript (strict), zod 4.

**Спека:** `docs/superpowers/specs/2026-10-07-rave-battle-design.md`

**Решения, принятые в этом плане (не противоречат спеке, уточняют её):**
- `PlayerRegistry` держит в памяти **всех** игроков сезона (не только онлайн): бонус автору бомбы начисляется, даже если автор офлайн. Для тысяч игроков это мегабайты.
- Расход предметов (бомба при установке, использования детектора/дефьюзера) пишется в ledger с `reason = "use"`.
- При заморозке частичный прогресс восстановления текущего заряда теряется (восстановление начинается заново с `frozenUntil`).
- Заморозка блокирует пиксели, детектор и дефьюзер; покупки и дейлик — разрешены.
- Пустая клетка: `colorId = 0`, `ownerId = 0` (`users.id` начинается с 1). Палитра id 0 — чёрный фон.
- Буст ёмкости зарядов: цена 500, +5 за покупку, максимум +10 суммарно (значения дефолтного конфига).
- Награда дейлика — один предмет в день.

---

## Файловая структура

```
rave-battle/
├── package.json                       корень: workspaces, скрипты test/typecheck
├── tsconfig.json                      общий strict-конфиг TS
├── .gitignore
├── packages/shared/
│   ├── package.json                   @rave/shared, exports ./src/index.ts
│   └── src/
│       ├── index.ts                   реэкспорт
│       ├── constants.ts               CHUNK_SIZE, лимиты палитры
│       ├── time.ts                    dateKey(now, tz), DAY_MS
│       ├── time.test.ts
│       └── config/
│           ├── schema.ts              zod-схема GameConfig + типы
│           ├── defaults.ts            defaultConfig (32 цвета, все числа спеки)
│           └── schema.test.ts
└── apps/server/
    ├── package.json                   @rave/server
    └── src/engine/
        ├── types.ts                   PlayerState, RejectCode, EngineEvent, результаты команд
        ├── charges.ts                 chargeCap, settleCharges
        ├── charges.test.ts
        ├── canvas-store.ts            чанки colors/owners, территория, resize
        ├── canvas-store.test.ts
        ├── bomb-store.ts              активные бомбы по клеткам
        ├── bomb-store.test.ts
        ├── anti-farm.ts               лимит засчитываемых подрывов пары в сутки
        ├── anti-farm.test.ts
        ├── player.ts                  createPlayer, PlayerRegistry
        ├── access.ts                  accessError (бан, гильдия, возраст)
        ├── engine.ts                  GameEngine
        ├── test-utils.ts              makeEngine, T0
        ├── engine.place.test.ts       пиксели, бомбы, взрывы, анти-фарм
        ├── engine.tools.test.ts       детектор, дефьюзер
        ├── engine.shop.test.ts        покупки
        └── engine.daily.test.ts       дейлик
```

---

### Task 1: Каркас монорепо

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/constants.ts`
- Create: `apps/server/package.json`

- [ ] **Step 1: Создать корневой `package.json`**

```json
{
  "name": "rave-battle",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Создать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["apps/*/src", "packages/*/src"]
}
```

- [ ] **Step 3: Создать `.gitignore`**

```
node_modules/
dist/
.env
.env.*
!.env.example
tmp/
.DS_Store
```

- [ ] **Step 4: Создать `packages/shared/package.json`**

```json
{
  "name": "@rave/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 5: Создать `packages/shared/src/constants.ts`**

```ts
/** Side length of a canvas chunk in pixels. Canvas dimensions must be multiples of it. */
export const CHUNK_SIZE = 256;

/** Pixel color is stored as one byte, so the palette has at most 256 entries. */
export const MAX_PALETTE_SIZE = 256;

/** Palette ids 0..31 are base colors available to everyone. */
export const BASE_COLOR_COUNT = 32;
```

- [ ] **Step 6: Создать `packages/shared/src/index.ts`**

```ts
export * from "./constants";
```

- [ ] **Step 7: Создать `apps/server/package.json`**

```json
{
  "name": "@rave/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@rave/shared": "workspace:*"
  }
}
```

- [ ] **Step 8: Установить зависимости**

Run:
```bash
bun add -d typescript @types/bun
bun add zod --cwd packages/shared
bun install
```
Expected: `bun.lock` создан, `node_modules/@rave/shared` — симлинк на `packages/shared`.

- [ ] **Step 9: Проверить typecheck**

Run: `bun run typecheck`
Expected: завершается без ошибок (exit 0, без вывода).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lock packages/shared apps/server/package.json
git commit -m "chore: scaffold bun workspaces monorepo"
```

---

### Task 2: `dateKey` — календарная дата в часовом поясе

**Files:**
- Create: `packages/shared/src/time.ts`
- Test: `packages/shared/src/time.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Написать падающий тест**

`packages/shared/src/time.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { dateKey } from "./time";

describe("dateKey", () => {
  test("returns YYYY-MM-DD in the given time zone", () => {
    // 20:59:59 UTC = 23:59:59 in Moscow (UTC+3)
    expect(dateKey(Date.UTC(2026, 9, 7, 20, 59, 59), "Europe/Moscow")).toBe("2026-10-07");
    // 21:00:00 UTC = 00:00:00 next day in Moscow
    expect(dateKey(Date.UTC(2026, 9, 7, 21, 0, 0), "Europe/Moscow")).toBe("2026-10-08");
  });

  test("works for UTC", () => {
    expect(dateKey(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC")).toBe("2026-01-01");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `bun test packages/shared/src/time.test.ts`
Expected: FAIL — `Cannot find module './time'`.

- [ ] **Step 3: Реализовать**

`packages/shared/src/time.ts`:
```ts
export const DAY_MS = 86_400_000;

/** Calendar date ("YYYY-MM-DD") of the instant `nowMs` in the IANA time zone `timeZone`. */
export function dateKey(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
```

Добавить в `packages/shared/src/index.ts`:
```ts
export * from "./constants";
export * from "./time";
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `bun test packages/shared/src/time.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add timezone-aware dateKey"
```

---

### Task 3: zod-схема динамического конфига и дефолты

**Files:**
- Create: `packages/shared/src/config/schema.ts`, `packages/shared/src/config/defaults.ts`
- Test: `packages/shared/src/config/schema.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Написать падающий тест**

`packages/shared/src/config/schema.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./defaults";
import { gameConfigSchema, type GameConfig } from "./schema";

const clone = (): GameConfig => structuredClone(defaultConfig);

function issuePaths(cfg: unknown): string[] {
  const result = gameConfigSchema.safeParse(cfg);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("gameConfigSchema", () => {
  test("default config is valid", () => {
    expect(gameConfigSchema.safeParse(defaultConfig).success).toBe(true);
  });

  test("default config has 32 base colors and 512x512 canvas", () => {
    expect(defaultConfig.palette).toHaveLength(32);
    expect(defaultConfig.canvas).toEqual({ width: 512, height: 512 });
  });

  test("rejects canvas size that is not a multiple of the chunk size", () => {
    const cfg = clone();
    cfg.canvas.width = 500;
    expect(issuePaths(cfg)).toContain("canvas.width");
  });

  test("rejects duplicate palette ids", () => {
    const cfg = clone();
    cfg.palette.push({ id: 5, type: "solid", base: "#123456", params: {}, unlock: "daily" });
    expect(issuePaths(cfg)).toContain("palette.32.id");
  });

  test("rejects missing base color", () => {
    const cfg = clone();
    cfg.palette = cfg.palette.filter((entry) => entry.id !== 7);
    cfg.palette.push({ id: 40, type: "solid", base: "#123456", params: {}, unlock: "daily" });
    expect(issuePaths(cfg)).toContain("palette");
  });

  test("rejects base color that is not unlocked by default", () => {
    const cfg = clone();
    cfg.palette[3]!.unlock = "shop";
    cfg.palette[3]!.price = 10;
    expect(issuePaths(cfg)).toContain("palette");
  });

  test("rejects shop color without price", () => {
    const cfg = clone();
    cfg.palette.push({ id: 32, type: "animated", base: "#FF00FF", params: {}, unlock: "shop" });
    expect(issuePaths(cfg)).toContain("palette.32.price");
  });

  test("rejects unknown time zone", () => {
    const cfg = clone();
    cfg.daily.timezone = "Mars/Olympus";
    expect(issuePaths(cfg)).toContain("daily.timezone");
  });

  test("rejects empty daily rewards", () => {
    const cfg = clone();
    cfg.daily.rewards = [];
    expect(issuePaths(cfg)).toContain("daily.rewards");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `bun test packages/shared/src/config`
Expected: FAIL — `Cannot find module './defaults'`.

- [ ] **Step 3: Реализовать схему**

`packages/shared/src/config/schema.ts`:
```ts
import { z } from "zod";
import { BASE_COLOR_COUNT, CHUNK_SIZE, MAX_PALETTE_SIZE } from "../constants";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const ITEM_KEYS = ["bomb", "detector", "defuser"] as const;
export const itemKeySchema = z.enum(ITEM_KEYS);
export type ItemKey = z.infer<typeof itemKeySchema>;

export const paletteEntrySchema = z.object({
  id: z.number().int().min(0).max(MAX_PALETTE_SIZE - 1),
  type: z.enum(["solid", "animated", "gradient"]),
  /** Fallback color: clients that do not know `type` render the entry with it. */
  base: hexColor,
  params: z.record(z.string(), z.unknown()),
  unlock: z.enum(["default", "shop", "daily", "achievement"]),
  /** Required when `unlock` is "shop". */
  price: positiveInt.optional(),
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

export const rewardSchema = z.object({
  item: z.enum(["coins", "bomb", "detector", "defuser"]),
  amount: positiveInt,
});
export type Reward = z.infer<typeof rewardSchema>;

const shopItemSchema = z.object({
  price: positiveInt,
  /** Units (bombs) or uses (detector, defuser) granted per purchase. */
  amount: positiveInt,
});

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const gameConfigSchema = z
  .object({
    canvas: z.object({
      width: positiveInt.multipleOf(CHUNK_SIZE),
      height: positiveInt.multipleOf(CHUNK_SIZE),
    }),
    palette: z.array(paletteEntrySchema).min(BASE_COLOR_COUNT).max(MAX_PALETTE_SIZE),
    charges: z.object({ max: positiveInt, regenMs: positiveInt }),
    coinsPerPixel: nonNegativeInt,
    explosion: z.object({
      freezeMs: nonNegativeInt,
      coinPenalty: nonNegativeInt,
      selfFreezeMs: nonNegativeInt,
      selfCoinPenalty: nonNegativeInt,
      authorBonus: nonNegativeInt,
    }),
    bombs: z.object({ maxActivePerPlayer: positiveInt }),
    antiFarm: z.object({ maxRatedPerPairPerDay: nonNegativeInt }),
    defuse: z.object({ reward: nonNegativeInt }),
    shop: z.object({
      bomb: shopItemSchema,
      detector: shopItemSchema,
      defuser: shopItemSchema,
      chargeCapBoost: z.object({ price: positiveInt, amount: positiveInt, maxTotal: positiveInt }),
    }),
    starting: z.object({
      coins: nonNegativeInt,
      bomb: nonNegativeInt,
      detector: nonNegativeInt,
      defuser: nonNegativeInt,
    }),
    daily: z.object({
      timezone: z.string().min(1),
      rewards: z.array(rewardSchema).min(1),
    }),
    access: z.object({ minAccountAgeDays: nonNegativeInt }),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<number>();
    cfg.palette.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate palette id ${entry.id}`, path: ["palette", index, "id"], input: entry.id });
      }
      seen.add(entry.id);
      if (entry.unlock === "shop" && entry.price === undefined) {
        ctx.addIssue({ code: "custom", message: "Shop colors need a price", path: ["palette", index, "price"], input: entry });
      }
    });

    for (let id = 0; id < BASE_COLOR_COUNT; id++) {
      const entry = cfg.palette.find((e) => e.id === id);
      if (!entry || entry.unlock !== "default") {
        ctx.addIssue({ code: "custom", message: `Base color ${id} must exist with unlock "default"`, path: ["palette"], input: cfg.palette });
      }
    }

    if (!isValidTimeZone(cfg.daily.timezone)) {
      ctx.addIssue({ code: "custom", message: "Unknown time zone", path: ["daily", "timezone"], input: cfg.daily.timezone });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
```

- [ ] **Step 4: Реализовать дефолты**

`packages/shared/src/config/defaults.ts`:
```ts
import type { GameConfig, PaletteEntry } from "./schema";

// r/place 2022 palette, black first: id 0 is the empty-canvas background.
const BASE_COLORS = [
  "#000000", "#6D001A", "#BE0039", "#FF4500", "#FFA800", "#FFD635", "#FFF8B8", "#00A368",
  "#00CC78", "#7EED56", "#00756F", "#009EAA", "#00CCC0", "#2450A4", "#3690EA", "#51E9F4",
  "#493AC1", "#6A5CFF", "#94B3FF", "#811E9F", "#B44AC0", "#E4ABFF", "#DE107F", "#FF3881",
  "#FF99AA", "#6D482F", "#9C6926", "#FFB470", "#515252", "#898D90", "#D4D7D9", "#FFFFFF",
];

export const defaultConfig: GameConfig = {
  canvas: { width: 512, height: 512 },
  palette: BASE_COLORS.map(
    (base, id): PaletteEntry => ({ id, type: "solid", base, params: {}, unlock: "default" }),
  ),
  charges: { max: 10, regenMs: 30_000 },
  coinsPerPixel: 1,
  explosion: {
    freezeMs: 60_000,
    coinPenalty: 10,
    selfFreezeMs: 120_000,
    selfCoinPenalty: 20,
    authorBonus: 15,
  },
  bombs: { maxActivePerPlayer: 20 },
  antiFarm: { maxRatedPerPairPerDay: 3 },
  defuse: { reward: 20 },
  shop: {
    bomb: { price: 30, amount: 1 },
    detector: { price: 40, amount: 5 },
    defuser: { price: 150, amount: 2 },
    chargeCapBoost: { price: 500, amount: 5, maxTotal: 10 },
  },
  starting: { coins: 100, bomb: 3, detector: 5, defuser: 0 },
  daily: {
    timezone: "Europe/Moscow",
    rewards: [
      { item: "coins", amount: 30 },
      { item: "bomb", amount: 1 },
      { item: "detector", amount: 5 },
      { item: "coins", amount: 50 },
      { item: "bomb", amount: 2 },
      { item: "detector", amount: 5 },
      { item: "defuser", amount: 2 },
    ],
  },
  access: { minAccountAgeDays: 30 },
};
```

`packages/shared/src/index.ts`:
```ts
export * from "./constants";
export * from "./time";
export * from "./config/schema";
export * from "./config/defaults";
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `bun test packages/shared`
Expected: PASS, 11 tests (9 config + 2 time).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add game config schema and defaults"
```

---

### Task 4: Типы движка и ленивые заряды

**Files:**
- Create: `apps/server/src/engine/types.ts`, `apps/server/src/engine/charges.ts`
- Test: `apps/server/src/engine/charges.test.ts`

- [ ] **Step 1: Создать `types.ts`**

`apps/server/src/engine/types.ts`:
```ts
import type { ItemKey, Reward } from "@rave/shared";

export type UserId = number;
export type Inventory = Record<ItemKey, number>;

export interface PlayerState {
  userId: UserId;
  coins: number;
  /** Charges as of `chargesUpdatedAt`; call settleCharges() before reading. */
  charges: number;
  chargesUpdatedAt: number;
  /** Epoch ms; 0 = not frozen. Actions and charge regen are blocked until then. */
  frozenUntil: number;
  chargeCapBonus: number;
  inventory: Inventory;
  unlockedColors: Set<number>;
  /** Index of the next daily reward. */
  dailyStep: number;
  /** dateKey() of the last claim, or null. */
  dailyLastClaim: string | null;
  /** Epoch ms; null = not banned, Infinity = permanent. */
  bannedUntil: number | null;
  /** Discord account creation time, epoch ms. */
  accountCreatedAt: number;
  /** True when the guild check is disabled or the user is a member. */
  guildMember: boolean;
}

export type RejectCode =
  | "banned"
  | "not_guild_member"
  | "account_too_new"
  | "frozen"
  | "out_of_bounds"
  | "invalid_color"
  | "color_locked"
  | "no_charges"
  | "no_bombs"
  | "bomb_limit"
  | "no_detector"
  | "no_defuser"
  | "insufficient_coins"
  | "boost_limit"
  | "not_for_sale"
  | "already_unlocked"
  | "already_claimed";

export type Rejected = { ok: false; code: RejectCode };

export type LedgerItem = "coins" | ItemKey;
export type LedgerReason = "shop" | "daily" | "explosion" | "bomb_bonus" | "defuse" | "use";
export type StatKey =
  | "pixels"
  | "coinsFromPixels"
  | "bombsTriggered"
  | "explosionsSuffered"
  | "selfExplosions"
  | "defused";

export type EngineEvent =
  | { type: "pixel"; x: number; y: number; userId: UserId; colorId: number; prevColorId: number; prevUserId: UserId; at: number }
  | { type: "bomb_added"; x: number; y: number; ownerId: UserId; at: number }
  | { type: "bomb_removed"; x: number; y: number; ownerId: UserId; reason: "exploded" | "defused"; removedBy: UserId; at: number }
  | { type: "ledger"; userId: UserId; item: LedgerItem; delta: number; balanceAfter: number; reason: LedgerReason; ref: Record<string, unknown>; at: number }
  | { type: "stat"; userId: UserId; day: string; stat: StatKey; delta: number }
  | { type: "color_unlocked"; userId: UserId; colorId: number; source: "shop"; at: number }
  /** Player state changed; the persister upserts the current snapshot. */
  | { type: "player"; userId: UserId };

export interface PlaceCommand {
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
}

export type PlaceResult =
  | Rejected
  | { ok: true; outcome: "placed" }
  | { ok: true; outcome: "exploded"; self: boolean; frozenUntil: number; coinsLost: number; bombOwnerId: UserId };

export type DetectResult = Rejected | { ok: true; count: number };
export type DefuseResult = Rejected | { ok: true; found: boolean; reward: number };
export type BuyResult = Rejected | { ok: true };
export type DailyResult = Rejected | { ok: true; reward: Reward };
```

- [ ] **Step 2: Написать падающий тест зарядов**

`apps/server/src/engine/charges.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { chargeCap, settleCharges } from "./charges";
import type { PlayerState } from "./types";

const T0 = 1_000_000;
const cfg = defaultConfig; // max 10, regen 30 s

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    userId: 1,
    coins: 0,
    charges: 10,
    chargesUpdatedAt: T0,
    frozenUntil: 0,
    chargeCapBonus: 0,
    inventory: { bomb: 0, detector: 0, defuser: 0 },
    unlockedColors: new Set(),
    dailyStep: 0,
    dailyLastClaim: null,
    bannedUntil: null,
    accountCreatedAt: 0,
    guildMember: true,
    ...overrides,
  };
}

describe("chargeCap", () => {
  test("adds the bought bonus to the configured max", () => {
    expect(chargeCap(player({ chargeCapBonus: 5 }), cfg)).toBe(15);
  });
});

describe("settleCharges", () => {
  test("full player stays full and the regen timer restarts at now", () => {
    const p = player({ charges: 10 });
    settleCharges(p, cfg, T0 + 500_000);
    expect(p.charges).toBe(10);
    expect(p.chargesUpdatedAt).toBe(T0 + 500_000);
  });

  test("regenerates one charge per interval and keeps the partial progress", () => {
    const p = player({ charges: 0 });
    settleCharges(p, cfg, T0 + 65_000);
    expect(p.charges).toBe(2);
    expect(p.chargesUpdatedAt).toBe(T0 + 60_000);
  });

  test("never exceeds the cap", () => {
    const p = player({ charges: 9 });
    settleCharges(p, cfg, T0 + 600_000);
    expect(p.charges).toBe(10);
    expect(p.chargesUpdatedAt).toBe(T0 + 600_000);
  });

  test("does not regenerate while frozen; regen starts at frozenUntil", () => {
    const p = player({ charges: 0, frozenUntil: T0 + 60_000 });
    settleCharges(p, cfg, T0 + 75_000);
    expect(p.charges).toBe(0);
    settleCharges(p, cfg, T0 + 90_000);
    expect(p.charges).toBe(1);
  });
});
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `bun test apps/server/src/engine/charges.test.ts`
Expected: FAIL — `Cannot find module './charges'`.

- [ ] **Step 4: Реализовать**

`apps/server/src/engine/charges.ts`:
```ts
import type { GameConfig } from "@rave/shared";
import type { PlayerState } from "./types";

export function chargeCap(p: PlayerState, cfg: GameConfig): number {
  return cfg.charges.max + p.chargeCapBonus;
}

/**
 * Brings `p.charges` up to date at `now`. Regeneration is paused while frozen:
 * it counts from max(chargesUpdatedAt, frozenUntil).
 */
export function settleCharges(p: PlayerState, cfg: GameConfig, now: number): void {
  const cap = chargeCap(p, cfg);
  if (p.charges >= cap) {
    p.charges = cap;
    p.chargesUpdatedAt = now;
    return;
  }
  const from = Math.max(p.chargesUpdatedAt, p.frozenUntil);
  if (now <= from) return;
  const gained = Math.floor((now - from) / cfg.charges.regenMs);
  if (gained === 0) return;
  p.charges = Math.min(cap, p.charges + gained);
  p.chargesUpdatedAt = p.charges >= cap ? now : from + gained * cfg.charges.regenMs;
}
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `bun test apps/server/src/engine/charges.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add engine types and lazy charge regeneration"
```

---

### Task 5: `CanvasStore`

**Files:**
- Create: `apps/server/src/engine/canvas-store.ts`
- Test: `apps/server/src/engine/canvas-store.test.ts`

- [ ] **Step 1: Написать падающий тест**

`apps/server/src/engine/canvas-store.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { CanvasStore } from "./canvas-store";

describe("CanvasStore", () => {
  test("empty cell is color 0 owned by nobody", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.get(10, 10)).toEqual({ colorId: 0, ownerId: 0 });
  });

  test("set returns the previous state and get returns the new one", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.set(300, 20, 5, 7)).toEqual({ colorId: 0, ownerId: 0 });
    expect(canvas.set(300, 20, 9, 8)).toEqual({ colorId: 5, ownerId: 7 });
    expect(canvas.get(300, 20)).toEqual({ colorId: 9, ownerId: 8 });
  });

  test("tracks territory per owner", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(1, 1, 3, 7);
    canvas.set(2, 1, 3, 7);
    expect(canvas.territoryOf(7)).toBe(2);
    canvas.set(1, 1, 4, 8);
    expect(canvas.territoryOf(7)).toBe(1);
    expect(canvas.territoryOf(8)).toBe(1);
  });

  test("inBounds rejects negatives, overflow and non-integers", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.inBounds(0, 0)).toBe(true);
    expect(canvas.inBounds(511, 511)).toBe(true);
    expect(canvas.inBounds(-1, 0)).toBe(false);
    expect(canvas.inBounds(512, 0)).toBe(false);
    expect(canvas.inBounds(0, 512)).toBe(false);
    expect(canvas.inBounds(1.5, 0)).toBe(false);
  });

  test("chunks are allocated lazily and indexed row-major", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.getChunk(1, 0)).toBeUndefined();
    canvas.set(257, 2, 6, 3);
    const chunk = canvas.getChunk(1, 0);
    expect(chunk?.colors[2 * 256 + 1]).toBe(6);
    expect(chunk?.owners[2 * 256 + 1]).toBe(3);
  });

  test("dimensions must be multiples of the chunk size", () => {
    expect(() => new CanvasStore(500, 512)).toThrow();
  });

  test("resize grows and refuses to shrink", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.resize(768, 512);
    expect(canvas.width).toBe(768);
    expect(canvas.inBounds(700, 0)).toBe(true);
    expect(() => canvas.resize(512, 512)).toThrow();
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `bun test apps/server/src/engine/canvas-store.test.ts`
Expected: FAIL — `Cannot find module './canvas-store'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/engine/canvas-store.ts`:
```ts
import { CHUNK_SIZE } from "@rave/shared";
import type { UserId } from "./types";

export interface CellState {
  colorId: number;
  ownerId: UserId;
}

export interface Chunk {
  colors: Uint8Array;
  owners: Int32Array;
}

function assertChunkAligned(width: number, height: number): void {
  if (width <= 0 || height <= 0 || width % CHUNK_SIZE !== 0 || height % CHUNK_SIZE !== 0) {
    throw new Error(`Canvas ${width}x${height} must be positive multiples of ${CHUNK_SIZE}`);
  }
}

const chunkKey = (cx: number, cy: number) => `${cx}:${cy}`;
const localIndex = (x: number, y: number) => (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);

export class CanvasStore {
  private chunks = new Map<string, Chunk>();
  private territory = new Map<UserId, number>();

  constructor(
    private _width: number,
    private _height: number,
  ) {
    assertChunkAligned(_width, _height);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this._width && y < this._height;
  }

  get(x: number, y: number): CellState {
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)));
    if (!chunk) return { colorId: 0, ownerId: 0 };
    const i = localIndex(x, y);
    return { colorId: chunk.colors[i] ?? 0, ownerId: chunk.owners[i] ?? 0 };
  }

  /** Writes a cell and returns its previous state. Caller must check inBounds(). */
  set(x: number, y: number, colorId: number, ownerId: UserId): CellState {
    const chunk = this.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
    const i = localIndex(x, y);
    const prev: CellState = { colorId: chunk.colors[i] ?? 0, ownerId: chunk.owners[i] ?? 0 };
    chunk.colors[i] = colorId;
    chunk.owners[i] = ownerId;
    this.addTerritory(prev.ownerId, -1);
    this.addTerritory(ownerId, 1);
    return prev;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  territoryOf(userId: UserId): number {
    return this.territory.get(userId) ?? 0;
  }

  resize(width: number, height: number): void {
    assertChunkAligned(width, height);
    if (width < this._width || height < this._height) {
      throw new Error(`Canvas can only grow: ${this._width}x${this._height} -> ${width}x${height}`);
    }
    this._width = width;
    this._height = height;
  }

  private ensureChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = {
        colors: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
        owners: new Int32Array(CHUNK_SIZE * CHUNK_SIZE),
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private addTerritory(ownerId: UserId, delta: number): void {
    if (ownerId === 0) return;
    const next = (this.territory.get(ownerId) ?? 0) + delta;
    if (next === 0) this.territory.delete(ownerId);
    else this.territory.set(ownerId, next);
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `bun test apps/server/src/engine/canvas-store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add chunked canvas store with territory tracking"
```

---

### Task 6: `BombStore`

**Files:**
- Create: `apps/server/src/engine/bomb-store.ts`
- Test: `apps/server/src/engine/bomb-store.test.ts`

- [ ] **Step 1: Написать падающий тест**

`apps/server/src/engine/bomb-store.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { BombStore } from "./bomb-store";

describe("BombStore", () => {
  test("add, get and remove a bomb", () => {
    const bombs = new BombStore();
    bombs.add({ x: 3, y: 4, ownerId: 1, createdAt: 100 });
    expect(bombs.get(3, 4)).toEqual({ x: 3, y: 4, ownerId: 1, createdAt: 100 });
    expect(bombs.get(4, 3)).toBeUndefined();
    expect(bombs.remove(3, 4)?.ownerId).toBe(1);
    expect(bombs.get(3, 4)).toBeUndefined();
    expect(bombs.remove(3, 4)).toBeUndefined();
  });

  test("refuses a second bomb on the same cell", () => {
    const bombs = new BombStore();
    bombs.add({ x: 1, y: 1, ownerId: 1, createdAt: 0 });
    expect(() => bombs.add({ x: 1, y: 1, ownerId: 2, createdAt: 0 })).toThrow();
  });

  test("counts active bombs per owner", () => {
    const bombs = new BombStore();
    bombs.add({ x: 1, y: 1, ownerId: 1, createdAt: 0 });
    bombs.add({ x: 2, y: 1, ownerId: 1, createdAt: 0 });
    bombs.add({ x: 3, y: 1, ownerId: 2, createdAt: 0 });
    expect(bombs.activeCount(1)).toBe(2);
    bombs.remove(1, 1);
    expect(bombs.activeCount(1)).toBe(1);
    expect(bombs.activeCount(3)).toBe(0);
  });

  test("countAround counts the 3x3 square including the center", () => {
    const bombs = new BombStore();
    for (const [x, y] of [[4, 4], [5, 6], [6, 6], [8, 8], [5, 5]] as const) {
      bombs.add({ x, y, ownerId: 1, createdAt: 0 });
    }
    expect(bombs.countAround(5, 5)).toBe(4);
    expect(bombs.countAround(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `bun test apps/server/src/engine/bomb-store.test.ts`
Expected: FAIL — `Cannot find module './bomb-store'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/engine/bomb-store.ts`:
```ts
import type { UserId } from "./types";

export interface Bomb {
  x: number;
  y: number;
  ownerId: UserId;
  createdAt: number;
}

const cellKey = (x: number, y: number) => `${x}:${y}`;

/** Active bombs. Never serialized to clients. */
export class BombStore {
  private byCell = new Map<string, Bomb>();
  private perOwner = new Map<UserId, number>();

  get(x: number, y: number): Bomb | undefined {
    return this.byCell.get(cellKey(x, y));
  }

  add(bomb: Bomb): void {
    const key = cellKey(bomb.x, bomb.y);
    if (this.byCell.has(key)) throw new Error(`Cell ${key} already has a bomb`);
    this.byCell.set(key, bomb);
    this.perOwner.set(bomb.ownerId, this.activeCount(bomb.ownerId) + 1);
  }

  remove(x: number, y: number): Bomb | undefined {
    const key = cellKey(x, y);
    const bomb = this.byCell.get(key);
    if (!bomb) return undefined;
    this.byCell.delete(key);
    const left = this.activeCount(bomb.ownerId) - 1;
    if (left === 0) this.perOwner.delete(bomb.ownerId);
    else this.perOwner.set(bomb.ownerId, left);
    return bomb;
  }

  activeCount(ownerId: UserId): number {
    return this.perOwner.get(ownerId) ?? 0;
  }

  /** Number of bombs in the 3x3 square centered on (x, y). */
  countAround(x: number, y: number): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.byCell.has(cellKey(x + dx, y + dy))) count++;
      }
    }
    return count;
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `bun test apps/server/src/engine/bomb-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add bomb store"
```

---

### Task 7: `AntiFarm`

**Files:**
- Create: `apps/server/src/engine/anti-farm.ts`
- Test: `apps/server/src/engine/anti-farm.test.ts`

- [ ] **Step 1: Написать падающий тест**

`apps/server/src/engine/anti-farm.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { AntiFarm } from "./anti-farm";

describe("AntiFarm", () => {
  test("rates at most `limit` triggers per owner/victim pair per day", () => {
    const farm = new AntiFarm();
    const results = [1, 2, 3, 4].map(() => farm.register("2026-10-07", 1, 2, 3));
    expect(results).toEqual([true, true, true, false]);
  });

  test("pairs are independent and directional", () => {
    const farm = new AntiFarm();
    farm.register("2026-10-07", 1, 2, 1);
    expect(farm.register("2026-10-07", 1, 3, 1)).toBe(true);
    expect(farm.register("2026-10-07", 2, 1, 1)).toBe(true);
    expect(farm.register("2026-10-07", 1, 2, 1)).toBe(false);
  });

  test("a new day resets the counters", () => {
    const farm = new AntiFarm();
    farm.register("2026-10-07", 1, 2, 1);
    expect(farm.register("2026-10-08", 1, 2, 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `bun test apps/server/src/engine/anti-farm.test.ts`
Expected: FAIL — `Cannot find module './anti-farm'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/engine/anti-farm.ts`:
```ts
import type { UserId } from "./types";

/** Limits how many bomb triggers of the same owner→victim pair count toward the rating per day. */
export class AntiFarm {
  private day: string | null = null;
  private counts = new Map<string, number>();

  /** Registers a trigger; returns true if it should count toward the rating. */
  register(day: string, ownerId: UserId, victimId: UserId, limit: number): boolean {
    if (day !== this.day) {
      this.day = day;
      this.counts.clear();
    }
    const key = `${ownerId}:${victimId}`;
    const seen = this.counts.get(key) ?? 0;
    this.counts.set(key, seen + 1);
    return seen < limit;
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `bun test apps/server/src/engine/anti-farm.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add per-pair daily anti-farm counter"
```

---

### Task 8: Игроки, доступ, каркас `GameEngine` и установка пикселя

**Files:**
- Create: `apps/server/src/engine/player.ts`, `apps/server/src/engine/access.ts`, `apps/server/src/engine/engine.ts`, `apps/server/src/engine/test-utils.ts`
- Test: `apps/server/src/engine/engine.place.test.ts`

- [ ] **Step 1: Создать `player.ts`**

`apps/server/src/engine/player.ts`:
```ts
import type { GameConfig } from "@rave/shared";
import type { PlayerState, UserId } from "./types";

export interface NewPlayer {
  userId: UserId;
  accountCreatedAt: number;
  guildMember: boolean;
  now: number;
}

export function createPlayer(init: NewPlayer, cfg: GameConfig): PlayerState {
  return {
    userId: init.userId,
    coins: cfg.starting.coins,
    charges: cfg.charges.max,
    chargesUpdatedAt: init.now,
    frozenUntil: 0,
    chargeCapBonus: 0,
    inventory: {
      bomb: cfg.starting.bomb,
      detector: cfg.starting.detector,
      defuser: cfg.starting.defuser,
    },
    unlockedColors: new Set(),
    dailyStep: 0,
    dailyLastClaim: null,
    bannedUntil: null,
    accountCreatedAt: init.accountCreatedAt,
    guildMember: init.guildMember,
  };
}

/** All players of the season, online or not. */
export class PlayerRegistry {
  private players = new Map<UserId, PlayerState>();

  add(p: PlayerState): void {
    this.players.set(p.userId, p);
  }

  has(userId: UserId): boolean {
    return this.players.has(userId);
  }

  get(userId: UserId): PlayerState {
    const p = this.players.get(userId);
    if (!p) throw new Error(`Player ${userId} is not loaded`);
    return p;
  }
}
```

- [ ] **Step 2: Создать `access.ts`**

`apps/server/src/engine/access.ts`:
```ts
import { DAY_MS, type GameConfig } from "@rave/shared";
import type { PlayerState, RejectCode } from "./types";

/** Why the player may not play at all right now, or null. Freeze is checked separately. */
export function accessError(p: PlayerState, cfg: GameConfig, now: number): RejectCode | null {
  if (p.bannedUntil !== null && p.bannedUntil > now) return "banned";
  if (!p.guildMember) return "not_guild_member";
  if (now - p.accountCreatedAt < cfg.access.minAccountAgeDays * DAY_MS) return "account_too_new";
  return null;
}
```

- [ ] **Step 3: Создать `test-utils.ts`**

`apps/server/src/engine/test-utils.ts`:
```ts
import { DAY_MS, defaultConfig, type GameConfig } from "@rave/shared";
import { AntiFarm } from "./anti-farm";
import { BombStore } from "./bomb-store";
import { CanvasStore } from "./canvas-store";
import { GameEngine } from "./engine";
import { createPlayer, PlayerRegistry } from "./player";
import type { EngineEvent, PlayerState } from "./types";

/** 2026-10-07 12:00 UTC = 15:00 Moscow. */
export const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
export { DAY_MS };

export function makeEngine(configure?: (cfg: GameConfig) => void) {
  const cfg = structuredClone(defaultConfig);
  configure?.(cfg);
  const canvas = new CanvasStore(cfg.canvas.width, cfg.canvas.height);
  const bombs = new BombStore();
  const players = new PlayerRegistry();
  const engine = new GameEngine(cfg, canvas, bombs, players, new AntiFarm());

  const addPlayer = (userId: number): PlayerState => {
    const p = createPlayer({ userId, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true, now: T0 }, cfg);
    players.add(p);
    return p;
  };

  return { cfg, canvas, bombs, players, engine, addPlayer };
}

export function eventsOf<T extends EngineEvent["type"]>(events: EngineEvent[], type: T) {
  return events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
}
```

- [ ] **Step 4: Написать падающие тесты установки пикселя (без бомб)**

`apps/server/src/engine/engine.place.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { DAY_MS, eventsOf, makeEngine, T0 } from "./test-utils";

const place = (x: number, y: number, colorId = 3, withBomb = false) => ({ x, y, colorId, withBomb });

describe("placePixel: plain pixels", () => {
  test("paints the cell, spends a charge and pays a coin", () => {
    const { engine, canvas, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(10, 20), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(canvas.get(10, 20)).toEqual({ colorId: 3, ownerId: 1 });
    expect(a.charges).toBe(9);
    expect(a.coins).toBe(101);

    const events = engine.drainEvents();
    expect(eventsOf(events, "pixel")).toEqual([
      { type: "pixel", x: 10, y: 20, userId: 1, colorId: 3, prevColorId: 0, prevUserId: 0, at: T0 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.stat, e.delta, e.day])).toEqual([
      ["pixels", 1, "2026-10-07"],
      ["coinsFromPixels", 1, "2026-10-07"],
    ]);
    expect(eventsOf(events, "player")).toEqual([{ type: "player", userId: 1 }]);
    expect(engine.drainEvents()).toEqual([]);
  });

  test("rejects out-of-bounds and unknown colors", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    expect(engine.placePixel(1, place(512, 0), T0)).toEqual({ ok: false, code: "out_of_bounds" });
    expect(engine.placePixel(1, place(0, 0, 200), T0)).toEqual({ ok: false, code: "invalid_color" });
  });

  test("rejects locked colors until unlocked", () => {
    const { engine, addPlayer } = makeEngine((cfg) => {
      cfg.palette.push({ id: 32, type: "animated", base: "#FF00FF", params: {}, unlock: "shop", price: 200 });
    });
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(0, 0, 32), T0)).toEqual({ ok: false, code: "color_locked" });
    a.unlockedColors.add(32);
    expect(engine.placePixel(1, place(0, 0, 32), T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("rejects when out of charges and accepts again after regen", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.charges = 0;
    a.chargesUpdatedAt = T0;
    expect(engine.placePixel(1, place(0, 0), T0 + 29_000)).toEqual({ ok: false, code: "no_charges" });
    expect(engine.placePixel(1, place(0, 0), T0 + 30_000)).toEqual({ ok: true, outcome: "placed" });
  });

  test("rejects banned, too-new, non-member and frozen players", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.bannedUntil = T0 + 1;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.guildMember = false;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "not_guild_member" });
    a.guildMember = true;
    a.accountCreatedAt = T0 - 29 * DAY_MS;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "account_too_new" });
    a.accountCreatedAt = T0 - 30 * DAY_MS;
    a.frozenUntil = T0 + 1;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "frozen" });
  });

  test("a rejected command emits no events and changes nothing", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.placePixel(1, place(-1, 0), T0);
    expect(engine.drainEvents()).toEqual([]);
    expect(a.charges).toBe(10);
  });
});
```

- [ ] **Step 5: Запустить тест, убедиться что падает**

Run: `bun test apps/server/src/engine/engine.place.test.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 6: Реализовать каркас `GameEngine` с установкой пикселя**

`apps/server/src/engine/engine.ts`:
```ts
import { dateKey, type GameConfig } from "@rave/shared";
import { accessError } from "./access";
import type { AntiFarm } from "./anti-farm";
import type { BombStore } from "./bomb-store";
import type { CanvasStore } from "./canvas-store";
import { settleCharges } from "./charges";
import type { PlayerRegistry } from "./player";
import type {
  EngineEvent,
  LedgerItem,
  LedgerReason,
  PlaceCommand,
  PlaceResult,
  PlayerState,
  RejectCode,
  Rejected,
  StatKey,
  UserId,
} from "./types";

const reject = (code: RejectCode): Rejected => ({ ok: false, code });

/**
 * Single writer of game state. Pure: no I/O, time comes from `now`.
 * Every successful command appends events to the outbox; rejected commands change nothing.
 */
export class GameEngine {
  private outbox: EngineEvent[] = [];

  constructor(
    private cfg: GameConfig,
    readonly canvas: CanvasStore,
    readonly bombs: BombStore,
    readonly players: PlayerRegistry,
    private antiFarm: AntiFarm,
  ) {}

  get config(): GameConfig {
    return this.cfg;
  }

  drainEvents(): EngineEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  placePixel(userId: UserId, cmd: PlaceCommand, now: number): PlaceResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cmd.x, cmd.y)) return reject("out_of_bounds");
    const colorDenied = this.colorError(p, cmd.colorId);
    if (colorDenied) return reject(colorDenied);
    settleCharges(p, this.cfg, now);
    if (p.charges < 1) return reject("no_charges");

    p.charges -= 1;
    const day = dateKey(now, this.cfg.daily.timezone);

    const prev = this.canvas.set(cmd.x, cmd.y, cmd.colorId, userId);
    this.emit({ type: "pixel", x: cmd.x, y: cmd.y, userId, colorId: cmd.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
    p.coins += this.cfg.coinsPerPixel;
    this.stat(userId, day, "pixels", 1);
    this.stat(userId, day, "coinsFromPixels", this.cfg.coinsPerPixel);
    this.emit({ type: "player", userId });
    return { ok: true, outcome: "placed" };
  }

  /** Access problems plus freeze: blocks pixels and sapper tools. */
  private actionError(p: PlayerState, now: number): RejectCode | null {
    return accessError(p, this.cfg, now) ?? (p.frozenUntil > now ? "frozen" : null);
  }

  private colorError(p: PlayerState, colorId: number): RejectCode | null {
    const entry = this.cfg.palette.find((e) => e.id === colorId);
    if (!entry) return "invalid_color";
    if (entry.unlock !== "default" && !p.unlockedColors.has(colorId)) return "color_locked";
    return null;
  }

  private emit(event: EngineEvent): void {
    this.outbox.push(event);
  }

  private stat(userId: UserId, day: string, stat: StatKey, delta: number): void {
    if (delta !== 0) this.emit({ type: "stat", userId, day, stat, delta });
  }

  /** Call after mutating the balance: records the new balance. */
  private ledger(p: PlayerState, item: LedgerItem, delta: number, reason: LedgerReason, now: number, ref: Record<string, unknown> = {}): void {
    if (delta === 0) return;
    const balanceAfter = item === "coins" ? p.coins : p.inventory[item];
    this.emit({ type: "ledger", userId: p.userId, item, delta, balanceAfter, reason, ref, at: now });
  }
}
```

- [ ] **Step 7: Запустить тесты, убедиться что проходят**

Run: `bun test apps/server/src/engine/engine.place.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Typecheck**

Run: `bun run typecheck`
Expected: exit 0. Поле `antiFarm` и метод `ledger` пока не используются — TS не ругается на неиспользуемые private-члены без `noUnusedLocals`; оба понадобятся в Task 9.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add game engine with pixel placement"
```

---

### Task 9: Бомбы и взрывы

**Files:**
- Modify: `apps/server/src/engine/engine.ts` (метод `placePixel`, новый `explode`)
- Test: `apps/server/src/engine/engine.place.test.ts` (дописать)

- [ ] **Step 1: Дописать падающие тесты**

В конец `apps/server/src/engine/engine.place.test.ts`:
```ts
describe("placePixel: bombs", () => {
  test("placing with a bomb spends a bomb and arms the cell", () => {
    const { engine, bombs, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(5, 5, 3, true), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(a.inventory.bomb).toBe(2);
    expect(bombs.get(5, 5)?.ownerId).toBe(1);
    const events = engine.drainEvents();
    expect(eventsOf(events, "bomb_added")).toEqual([{ type: "bomb_added", x: 5, y: 5, ownerId: 1, at: T0 }]);
    expect(eventsOf(events, "ledger")).toEqual([
      { type: "ledger", userId: 1, item: "bomb", delta: -1, balanceAfter: 2, reason: "use", ref: {}, at: T0 },
    ]);
  });

  test("rejects when the player has no bombs or hit the active-bomb limit", () => {
    const { engine, addPlayer } = makeEngine((cfg) => {
      cfg.bombs.maxActivePerPlayer = 1;
    });
    const a = addPlayer(1);
    engine.placePixel(1, place(1, 1, 3, true), T0);
    expect(engine.placePixel(1, place(2, 2, 3, true), T0)).toEqual({ ok: false, code: "bomb_limit" });
    a.inventory.bomb = 0;
    expect(engine.placePixel(1, place(2, 2, 3, true), T0)).toEqual({ ok: false, code: "no_bombs" });
  });

  test("stepping on someone else's bomb: pixel not placed, victim frozen and fined, author paid", () => {
    const { engine, canvas, bombs, addPlayer } = makeEngine();
    const a = addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.drainEvents();

    const result = engine.placePixel(2, place(5, 5, 9), T0 + 1000);
    expect(result).toEqual({ ok: true, outcome: "exploded", self: false, frozenUntil: T0 + 61_000, coinsLost: 10, bombOwnerId: 1 });
    expect(canvas.get(5, 5)).toEqual({ colorId: 3, ownerId: 1 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(b.charges).toBe(9);
    expect(b.coins).toBe(90);
    expect(b.frozenUntil).toBe(T0 + 61_000);
    expect(a.coins).toBe(101 + 15);

    const events = engine.drainEvents();
    expect(eventsOf(events, "pixel")).toEqual([]);
    expect(eventsOf(events, "bomb_removed")).toEqual([
      { type: "bomb_removed", x: 5, y: 5, ownerId: 1, reason: "exploded", removedBy: 2, at: T0 + 1000 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.userId, e.stat])).toEqual([
      [2, "explosionsSuffered"],
      [1, "bombsTriggered"],
    ]);
    expect(eventsOf(events, "ledger").map((e) => [e.userId, e.delta, e.reason])).toEqual([
      [2, -10, "explosion"],
      [1, 15, "bomb_bonus"],
    ]);
  });

  test("a victim placing with a bomb keeps their bomb", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.placePixel(2, place(5, 5, 9, true), T0);
    expect(b.inventory.bomb).toBe(3);
  });

  test("stepping on your own bomb: double penalty, no bonus, not rated", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.drainEvents();

    const result = engine.placePixel(1, place(5, 5, 4), T0);
    expect(result).toEqual({ ok: true, outcome: "exploded", self: true, frozenUntil: T0 + 120_000, coinsLost: 20, bombOwnerId: 1 });
    expect(a.coins).toBe(101 - 20);
    const events = engine.drainEvents();
    expect(eventsOf(events, "stat").map((e) => e.stat)).toEqual(["selfExplosions"]);
    expect(eventsOf(events, "ledger").map((e) => e.reason)).toEqual(["explosion"]);
  });

  test("frozen victim keeps charges and can play after the freeze", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.placePixel(2, place(5, 5, 9), T0);
    expect(engine.placePixel(2, place(6, 6), T0 + 59_999)).toEqual({ ok: false, code: "frozen" });
    expect(engine.placePixel(2, place(6, 6), T0 + 60_000)).toEqual({ ok: true, outcome: "placed" });
    expect(b.charges).toBe(8);
  });

  test("fine never drops coins below zero", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    b.coins = 4;
    engine.placePixel(1, place(5, 5, 3, true), T0);
    const result = engine.placePixel(2, place(5, 5, 9), T0);
    expect(result.ok && result.outcome === "exploded" && result.coinsLost).toBe(4);
    expect(b.coins).toBe(0);
  });

  test("anti-farm: the same pair is rated at most 3 times a day, bonus is always paid", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.inventory.bomb = 4;
    addPlayer(2);
    for (let i = 0; i < 4; i++) engine.placePixel(1, place(i, 0, 3, true), T0);
    engine.drainEvents();

    for (let i = 0; i < 4; i++) {
      const result = engine.placePixel(2, place(i, 0, 9), T0 + i * 60_000);
      expect(result.ok && result.outcome).toBe("exploded");
    }
    const rated = eventsOf(engine.drainEvents(), "stat").filter((e) => e.userId === 1 && e.stat === "bombsTriggered");
    expect(rated).toHaveLength(3);
    expect(a.coins).toBe(104 + 4 * 15);
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что новые падают**

Run: `bun test apps/server/src/engine/engine.place.test.ts`
Expected: FAIL — новые тесты `placePixel: bombs` (бомба не ставится, взрыва нет); старые 6 проходят.

- [ ] **Step 3: Реализовать бомбы и взрыв**

В `apps/server/src/engine/engine.ts` заменить строку `import type { BombStore } from "./bomb-store";` на:

```ts
import type { Bomb, BombStore } from "./bomb-store";
```

Затем заменить метод `placePixel` целиком и добавить `explode`:

```ts
  placePixel(userId: UserId, cmd: PlaceCommand, now: number): PlaceResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cmd.x, cmd.y)) return reject("out_of_bounds");
    const colorDenied = this.colorError(p, cmd.colorId);
    if (colorDenied) return reject(colorDenied);
    settleCharges(p, this.cfg, now);
    if (p.charges < 1) return reject("no_charges");
    if (cmd.withBomb) {
      if (p.inventory.bomb < 1) return reject("no_bombs");
      if (this.bombs.activeCount(userId) >= this.cfg.bombs.maxActivePerPlayer) return reject("bomb_limit");
    }

    p.charges -= 1;
    const day = dateKey(now, this.cfg.daily.timezone);

    const bomb = this.bombs.get(cmd.x, cmd.y);
    if (bomb) return this.explode(p, bomb, day, now);

    const prev = this.canvas.set(cmd.x, cmd.y, cmd.colorId, userId);
    this.emit({ type: "pixel", x: cmd.x, y: cmd.y, userId, colorId: cmd.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
    p.coins += this.cfg.coinsPerPixel;
    this.stat(userId, day, "pixels", 1);
    this.stat(userId, day, "coinsFromPixels", this.cfg.coinsPerPixel);

    if (cmd.withBomb) {
      p.inventory.bomb -= 1;
      this.bombs.add({ x: cmd.x, y: cmd.y, ownerId: userId, createdAt: now });
      this.emit({ type: "bomb_added", x: cmd.x, y: cmd.y, ownerId: userId, at: now });
      this.ledger(p, "bomb", -1, "use", now);
    }

    this.emit({ type: "player", userId });
    return { ok: true, outcome: "placed" };
  }

  /** The pixel is not placed; the victim's own bomb (if any) is not spent. */
  private explode(victim: PlayerState, bomb: Bomb, day: string, now: number): PlaceResult {
    const self = bomb.ownerId === victim.userId;
    const ex = this.cfg.explosion;

    this.bombs.remove(bomb.x, bomb.y);
    this.emit({ type: "bomb_removed", x: bomb.x, y: bomb.y, ownerId: bomb.ownerId, reason: "exploded", removedBy: victim.userId, at: now });

    victim.frozenUntil = now + (self ? ex.selfFreezeMs : ex.freezeMs);
    const coinsLost = Math.min(victim.coins, self ? ex.selfCoinPenalty : ex.coinPenalty);
    victim.coins -= coinsLost;
    this.ledger(victim, "coins", -coinsLost, "explosion", now, { bombOwnerId: bomb.ownerId });

    if (self) {
      this.stat(victim.userId, day, "selfExplosions", 1);
    } else {
      this.stat(victim.userId, day, "explosionsSuffered", 1);
      const owner = this.players.get(bomb.ownerId);
      owner.coins += ex.authorBonus;
      this.ledger(owner, "coins", ex.authorBonus, "bomb_bonus", now, { victimId: victim.userId });
      if (this.antiFarm.register(day, owner.userId, victim.userId, this.cfg.antiFarm.maxRatedPerPairPerDay)) {
        this.stat(owner.userId, day, "bombsTriggered", 1);
      }
      this.emit({ type: "player", userId: owner.userId });
    }

    this.emit({ type: "player", userId: victim.userId });
    return { ok: true, outcome: "exploded", self, frozenUntil: victim.frozenUntil, coinsLost, bombOwnerId: bomb.ownerId };
  }
```

Порядок событий в `explode` важен для тестов: `ledger` жертвы → `stat` жертвы → `ledger` автора → `stat` автора.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `bun test apps/server/src/engine/engine.place.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add bombs, explosions and anti-farm rating"
```

---

### Task 10: Детектор и дефьюзер

**Files:**
- Modify: `apps/server/src/engine/engine.ts` (методы `detect`, `defuse`)
- Test: `apps/server/src/engine/engine.tools.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/engine/engine.tools.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";

function armed(cells: Array<[number, number, number]>) {
  const ctx = makeEngine();
  for (const [x, y, ownerId] of cells) ctx.bombs.add({ x, y, ownerId, createdAt: T0 });
  return ctx;
}

describe("detect", () => {
  test("returns the number of bombs in the 3x3 square and spends one use", () => {
    const { engine, addPlayer } = armed([[4, 4, 9], [5, 6, 9], [6, 6, 9], [8, 8, 9]]);
    const a = addPlayer(1);
    expect(engine.detect(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, count: 3 });
    expect(a.inventory.detector).toBe(4);
    expect(eventsOf(engine.drainEvents(), "ledger")).toEqual([
      { type: "ledger", userId: 1, item: "detector", delta: -1, balanceAfter: 4, reason: "use", ref: {}, at: T0 },
    ]);
  });

  test("works at the canvas corner", () => {
    const { engine, addPlayer } = armed([[0, 0, 9], [1, 1, 9]]);
    addPlayer(1);
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: true, count: 2 });
  });

  test("rejects without uses, out of bounds and while frozen", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.detect(1, { x: -1, y: 0 }, T0)).toEqual({ ok: false, code: "out_of_bounds" });
    a.frozenUntil = T0 + 1;
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: false, code: "frozen" });
    a.frozenUntil = 0;
    a.inventory.detector = 0;
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: false, code: "no_detector" });
    expect(engine.drainEvents()).toEqual([]);
  });
});

describe("defuse", () => {
  test("removes someone else's bomb and pays the reward", () => {
    const { engine, bombs, addPlayer } = armed([[5, 5, 9]]);
    addPlayer(9);
    const a = addPlayer(1);
    a.inventory.defuser = 2;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: true, reward: 20 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(a.inventory.defuser).toBe(1);
    expect(a.coins).toBe(120);

    const events = engine.drainEvents();
    expect(eventsOf(events, "bomb_removed")).toEqual([
      { type: "bomb_removed", x: 5, y: 5, ownerId: 9, reason: "defused", removedBy: 1, at: T0 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.userId, e.stat])).toEqual([[1, "defused"]]);
    expect(eventsOf(events, "ledger").map((e) => [e.item, e.delta, e.reason])).toEqual([
      ["defuser", -1, "use"],
      ["coins", 20, "defuse"],
    ]);
  });

  test("defusing your own bomb gives nothing", () => {
    const { engine, bombs, addPlayer } = armed([[5, 5, 1]]);
    const a = addPlayer(1);
    a.inventory.defuser = 1;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: true, reward: 0 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(a.coins).toBe(100);
    expect(eventsOf(engine.drainEvents(), "stat")).toEqual([]);
  });

  test("an empty cell still burns the use", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.inventory.defuser = 1;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: false, reward: 0 });
    expect(a.inventory.defuser).toBe(0);
  });

  test("rejects without uses", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: false, code: "no_defuser" });
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `bun test apps/server/src/engine/engine.tools.test.ts`
Expected: FAIL — `engine.detect is not a function`.

- [ ] **Step 3: Реализовать**

В `apps/server/src/engine/engine.ts` дополнить импорт типов:
```ts
import type {
  DefuseResult,
  DetectResult,
  EngineEvent,
  LedgerItem,
  LedgerReason,
  PlaceCommand,
  PlaceResult,
  PlayerState,
  RejectCode,
  Rejected,
  StatKey,
  UserId,
} from "./types";
```

Добавить методы в класс `GameEngine` (после `placePixel`):
```ts
  detect(userId: UserId, cell: { x: number; y: number }, now: number): DetectResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cell.x, cell.y)) return reject("out_of_bounds");
    if (p.inventory.detector < 1) return reject("no_detector");

    p.inventory.detector -= 1;
    this.ledger(p, "detector", -1, "use", now);
    this.emit({ type: "player", userId });
    return { ok: true, count: this.bombs.countAround(cell.x, cell.y) };
  }

  defuse(userId: UserId, cell: { x: number; y: number }, now: number): DefuseResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cell.x, cell.y)) return reject("out_of_bounds");
    if (p.inventory.defuser < 1) return reject("no_defuser");

    p.inventory.defuser -= 1;
    this.ledger(p, "defuser", -1, "use", now);
    this.emit({ type: "player", userId });

    const bomb = this.bombs.remove(cell.x, cell.y);
    if (!bomb) return { ok: true, found: false, reward: 0 };
    this.emit({ type: "bomb_removed", x: bomb.x, y: bomb.y, ownerId: bomb.ownerId, reason: "defused", removedBy: userId, at: now });
    if (bomb.ownerId === userId) return { ok: true, found: true, reward: 0 };

    const reward = this.cfg.defuse.reward;
    p.coins += reward;
    this.ledger(p, "coins", reward, "defuse", now, { bombOwnerId: bomb.ownerId });
    this.stat(userId, dateKey(now, this.cfg.daily.timezone), "defused", 1);
    return { ok: true, found: true, reward };
  }
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `bun test apps/server/src/engine/engine.tools.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add detector and defuser"
```

---

### Task 11: Магазин

**Files:**
- Modify: `apps/server/src/engine/engine.ts` (методы `buyItem`, `buyChargeBoost`, `buyColor`, хелпер `spend`)
- Test: `apps/server/src/engine/engine.shop.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/engine/engine.shop.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { chargeCap } from "./charges";
import { eventsOf, makeEngine, T0 } from "./test-utils";

describe("buyItem", () => {
  test("buys a bomb", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: true });
    expect(a.coins).toBe(70);
    expect(a.inventory.bomb).toBe(4);
    expect(eventsOf(engine.drainEvents(), "ledger").map((e) => [e.item, e.delta, e.balanceAfter, e.reason])).toEqual([
      ["coins", -30, 70, "shop"],
      ["bomb", 1, 4, "shop"],
    ]);
  });

  test("a detector purchase grants its configured number of uses", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.buyItem(1, "detector", T0);
    expect(a.inventory.detector).toBe(10);
  });

  test("rejects when coins are short and when banned; frozen players may buy", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.coins = 29;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: false, code: "insufficient_coins" });
    a.coins = 100;
    a.bannedUntil = Number.POSITIVE_INFINITY;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.frozenUntil = T0 + 1;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: true });
  });
});

describe("buyChargeBoost", () => {
  test("raises the charge cap up to the configured total", () => {
    const { engine, cfg, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.coins = 1500;
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: true });
    expect(chargeCap(a, cfg)).toBe(15);
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: true });
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: false, code: "boost_limit" });
    expect(a.coins).toBe(500);
  });
});

describe("buyColor", () => {
  const withShopColor = () =>
    makeEngine((cfg) => {
      cfg.palette.push({ id: 32, type: "animated", base: "#FF00FF", params: {}, unlock: "shop", price: 200 });
      cfg.palette.push({ id: 33, type: "solid", base: "#00FFFF", params: {}, unlock: "daily" });
    });

  test("unlocks a shop color", () => {
    const { engine, addPlayer } = withShopColor();
    const a = addPlayer(1);
    a.coins = 300;
    expect(engine.buyColor(1, 32, T0)).toEqual({ ok: true });
    expect(a.coins).toBe(100);
    expect(a.unlockedColors.has(32)).toBe(true);
    expect(eventsOf(engine.drainEvents(), "color_unlocked")).toEqual([
      { type: "color_unlocked", userId: 1, colorId: 32, source: "shop", at: T0 },
    ]);
    expect(engine.buyColor(1, 32, T0)).toEqual({ ok: false, code: "already_unlocked" });
  });

  test("rejects colors that are not sold or do not exist", () => {
    const { engine, addPlayer } = withShopColor();
    addPlayer(1);
    expect(engine.buyColor(1, 5, T0)).toEqual({ ok: false, code: "not_for_sale" });
    expect(engine.buyColor(1, 33, T0)).toEqual({ ok: false, code: "not_for_sale" });
    expect(engine.buyColor(1, 99, T0)).toEqual({ ok: false, code: "invalid_color" });
  });

  test("rejects when coins are short", () => {
    const { engine, addPlayer } = withShopColor();
    addPlayer(1);
    expect(engine.buyColor(1, 32, T0)).toEqual({ ok: false, code: "insufficient_coins" });
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `bun test apps/server/src/engine/engine.shop.test.ts`
Expected: FAIL — `engine.buyItem is not a function`.

- [ ] **Step 3: Реализовать**

В `apps/server/src/engine/engine.ts`:

Импорт `ItemKey` из shared и `BuyResult` из types:
```ts
import { dateKey, type GameConfig, type ItemKey } from "@rave/shared";
```
```ts
import type {
  BuyResult,
  DefuseResult,
  DetectResult,
  EngineEvent,
  LedgerItem,
  LedgerReason,
  PlaceCommand,
  PlaceResult,
  PlayerState,
  RejectCode,
  Rejected,
  StatKey,
  UserId,
} from "./types";
```

Методы класса (после `defuse`):
```ts
  buyItem(userId: UserId, item: ItemKey, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const offer = this.cfg.shop[item];
    const short = this.spend(p, offer.price, now, { product: item });
    if (short) return reject(short);

    p.inventory[item] += offer.amount;
    this.ledger(p, item, offer.amount, "shop", now);
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  buyChargeBoost(userId: UserId, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const offer = this.cfg.shop.chargeCapBoost;
    if (p.chargeCapBonus + offer.amount > offer.maxTotal) return reject("boost_limit");
    const short = this.spend(p, offer.price, now, { product: "chargeCapBoost" });
    if (short) return reject(short);

    // Settle at the old cap so the regen timer stays consistent.
    settleCharges(p, this.cfg, now);
    p.chargeCapBonus += offer.amount;
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  buyColor(userId: UserId, colorId: number, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const entry = this.cfg.palette.find((e) => e.id === colorId);
    if (!entry) return reject("invalid_color");
    if (entry.unlock !== "shop" || entry.price === undefined) return reject("not_for_sale");
    if (p.unlockedColors.has(colorId)) return reject("already_unlocked");
    const short = this.spend(p, entry.price, now, { product: "color", colorId });
    if (short) return reject(short);

    p.unlockedColors.add(colorId);
    this.emit({ type: "color_unlocked", userId, colorId, source: "shop", at: now });
    this.emit({ type: "player", userId });
    return { ok: true };
  }
```

Хелпер (рядом с `ledger`):
```ts
  /** Charges `price` coins; returns a reject code instead if the player cannot afford it. */
  private spend(p: PlayerState, price: number, now: number, ref: Record<string, unknown>): RejectCode | null {
    if (p.coins < price) return "insufficient_coins";
    p.coins -= price;
    this.ledger(p, "coins", -price, "shop", now, ref);
    return null;
  }
```

`spend` вызывается последней проверкой, поэтому монеты списываются только когда все остальные проверки пройдены.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `bun test apps/server/src/engine/engine.shop.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add shop purchases"
```

---

### Task 12: Дейлик

**Files:**
- Modify: `apps/server/src/engine/engine.ts` (метод `claimDaily`)
- Test: `apps/server/src/engine/engine.daily.test.ts`

- [ ] **Step 1: Написать падающие тесты**

`apps/server/src/engine/engine.daily.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { DAY_MS, eventsOf, makeEngine, T0 } from "./test-utils";

describe("claimDaily", () => {
  test("grants the first reward once per day", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.claimDaily(1, T0)).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
    expect(a.coins).toBe(130);
    expect(a.dailyStep).toBe(1);
    expect(a.dailyLastClaim).toBe("2026-10-07");
    expect(eventsOf(engine.drainEvents(), "ledger").map((e) => [e.item, e.delta, e.reason])).toEqual([["coins", 30, "daily"]]);
    expect(engine.claimDaily(1, T0 + 1000)).toEqual({ ok: false, code: "already_claimed" });
  });

  test("the next day grants the next reward", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.claimDaily(1, T0);
    expect(engine.claimDaily(1, T0 + DAY_MS)).toEqual({ ok: true, reward: { item: "bomb", amount: 1 } });
    expect(a.inventory.bomb).toBe(4);
  });

  test("skipping days does not reset progress", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.claimDaily(1, T0);
    expect(engine.claimDaily(1, T0 + 5 * DAY_MS)).toEqual({ ok: true, reward: { item: "bomb", amount: 1 } });
  });

  test("the cycle wraps after the last reward", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    for (let day = 0; day < 7; day++) engine.claimDaily(1, T0 + day * DAY_MS);
    expect(a.dailyStep).toBe(0);
    expect(a.inventory.defuser).toBe(2);
    expect(engine.claimDaily(1, T0 + 7 * DAY_MS)).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
  });

  test("the day changes at midnight in the configured time zone", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.claimDaily(1, T0); // 15:00 Moscow, Oct 7
    // 21:30 UTC = 00:30 Moscow, Oct 8
    expect(engine.claimDaily(1, Date.UTC(2026, 9, 7, 21, 30)).ok).toBe(true);
  });

  test("banned players cannot claim; frozen players can", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.bannedUntil = T0 + 1;
    expect(engine.claimDaily(1, T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.frozenUntil = T0 + 1;
    expect(engine.claimDaily(1, T0).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `bun test apps/server/src/engine/engine.daily.test.ts`
Expected: FAIL — `engine.claimDaily is not a function`.

- [ ] **Step 3: Реализовать**

В `apps/server/src/engine/engine.ts` добавить `DailyResult` в импорт типов из `./types` и метод (после `buyColor`):
```ts
  claimDaily(userId: UserId, now: number): DailyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const day = dateKey(now, this.cfg.daily.timezone);
    if (p.dailyLastClaim === day) return reject("already_claimed");

    const rewards = this.cfg.daily.rewards;
    // Config edits may shorten the list; wrap the stored step into range.
    const reward = rewards[p.dailyStep % rewards.length]!;
    if (reward.item === "coins") p.coins += reward.amount;
    else p.inventory[reward.item] += reward.amount;
    this.ledger(p, reward.item, reward.amount, "daily", now);

    p.dailyStep = (p.dailyStep + 1) % rewards.length;
    p.dailyLastClaim = day;
    this.emit({ type: "player", userId });
    return { ok: true, reward };
  }
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `bun test apps/server/src/engine/engine.daily.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add daily rewards"
```

---

### Task 13: Финальная проверка

- [ ] **Step 1: Все тесты**

Run: `bun test`
Expected: PASS, 0 fail. Итого 64 теста: shared 11 (time 2 + config 9), charges 5, canvas-store 7, bomb-store 4, anti-farm 3, engine.place 14, engine.tools 7, engine.shop 7, engine.daily 6.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Проверить, что рабочее дерево чистое**

Run: `git status --short`
Expected: пустой вывод.
