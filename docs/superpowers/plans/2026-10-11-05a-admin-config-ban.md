# План 5a: админка — доступ, бан, правка игрока, журнал, редактор конфига — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** страница `/admin` для админов (`ADMIN_DISCORD_IDS`, в dev — `dev:admin`):
- поиск игрока и его карточка;
- бан и разбан с причиной;
- правка монет и инвентаря с записью в `ledger`;
- журнал модерации;
- редактор конфига с версиями, diff, откатом и живым применением, включая рост холста.

Плюс выбранные хвосты: единый источник банов, все причины «только просмотр», недостающие тесты, панель не закрывает «Выйти».

**Architecture:**
- **Доступ.** `isAdmin(user, serverConfig)`: Discord ID из `ADMIN_DISCORD_IDS`, а при `DEV_LOGIN=1` ещё и `dev:admin`. Проверка идёт на сервере в каждой `admin.*` процедуре (`adminProcedure`). Клиент узнаёт свой статус из `hello.admin` и показывает ссылку «Админка». Это только UI, не защита.
- **Бан.** `users.banned_until` / `ban_reason` и `mod_log` пишутся одной DB-транзакцией. Затем `engine.setAccess` применяет бан к игроку в движке и эмитит `player`, так что Hub сразу пушит новый `PlayerView`. Кеш рейтингов сбрасывается.
  - Бан действует так: только просмотр, сокеты и сессии сохраняются.
  - Рейтинги и профили берут бан из движка (единый источник).
- **Правка игрока.** `engine.adminAdjust` меняет баланс через дельты. Он эмитит `ledger` с `reason = "admin"`, `mod_log` (новое событие движка) и `player`. Всё это пишется group commit'ом одной транзакцией.
- **Конфиг.** `engine.applyConfig(next, change)` работает синхронно на единственном писателе:
  1. проверяет `baseVersion` (отказ на устаревшем сохранении);
  2. делает кросс-версионную проверку: холст не уменьшается, а записи палитры, которые есть на холсте, нельзя удалить или сменить им тип (счётчики цветов в `CanvasStore`);
  3. подменяет конфиг и растит холст;
  4. эмитит `config_changed` (новая строка `game_config` с явной версией) и `mod_log`.

  Запись атомарна с пикселями того же батча. После коммита Hub рассылает всем `{type:"config"}` и свежие `PlayerView` онлайн-игрокам, потому что `chargeCap` зависит от конфига. Клиент обновляет палитру, цены и размер холста без перезагрузки.
- **Админ-страница.** Ленивый чанк `apps/web/src/admin/` по пути `/admin`; обычные игроки его не скачивают. Внутри вкладки «Игроки», «Конфиг» и «Журнал». Состояние лежит в `?tab=&player=`. Валидация формы конфига идёт через `gameConfigSchema` из `@rave/shared`: zod попадает только в админ-чанк.

**Tech Stack:** Bun 1.3.6, drizzle 0.45.3 + postgres.js, tRPC 11.19.0, `@tanstack/react-query` 5.103.2, React 19.3, zustand 5, zod 4, bun test.

---

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Разбиение | 5a — доступ, `/admin`, журнал, бан, правка игрока, редактор конфига. 5b — откаты, очистка области, снятие бомб, инспектор клетки |
| Где UI | `/admin` в том же `apps/web`, ленивый чанк |
| Форма конфига | Секции с JSON-полем на каждую. Палитра — таблицей. Ошибки zod показываются под своей секцией; перед сохранением — diff |
| Админ в dev | `dev:admin` — админ при `DEV_LOGIN=1`, плюс все из `ADMIN_DISCORD_IDS` |
| Применение конфига | Живое, включая рост холста. Состояние вроде зарядов выше нового лимита обрезается при следующем `settle` |
| Эффект бана | Только просмотр, соединение остаётся. Игрок сразу получает новый `PlayerView` и баннер «заблокирован до …, причина …». Разбан работает симметрично |
| Правка игрока | Дельты (`+500 монет`, `-2 бомбы`) с обязательным комментарием. Баланс не уходит ниже 0 (иначе отказ). `ledger` с `reason=admin` плюс запись в `mod_log` |
| `config:defaults` | Вставляет дефолты, только если `game_config` пуст; иначе отказывается и отсылает к редактору |
| Форма бана | Пресеты 1 ч / 24 ч / 7 д / 30 д / навсегда и своя дата. Причина обязательна и видна игроку |
| Поиск игрока | Поиск по части имени, user id или Discord ID → карточка. Плюс кнопка «Модерировать» в игровом профиле (только для админа) |
| Журнал | Новые сверху, по 50 на страницу, фильтры по действию и по игроку |
| Сохранение конфига | Diff «путь: было → стало» и обязательный комментарий. В истории — автор, комментарий, дата. Откат создаёт новую версию-копию старой и проходит ту же проверку |
| Одновременная правка | Сохранение несёт `baseVersion`; если есть версия новее, приходит отказ `stale`, а текст в редакторе остаётся |
| Уведомление игроков | Тихое обновление, без тоста |
| Хвосты | Единый источник банов и сброс кеша; все причины «только просмотр»; тесты (лишние ключи профиля, обрезка топ-50 и `me` вне топа, тепловая карта на выросшем неквадратном холсте); панель не закрывает «Выйти» |

Дополнительные решения, которые я принял сам (можно оспорить):
- **Нельзя забанить себя или другого админа.** Иначе бан бессмыслен, потому что админ остаётся админом.
- **Правку игрока можно делать только тому, кто уже есть в движке** (заходил в игру). Иначе — `NOT_FOUND` «Игрок ещё не заходил в игру». Бан работает и для тех, кто не заходил: пишется только в БД, а при первом входе бан подхватится из `users`.
- **Версии `game_config` движок назначает явно** (`configVersion + 1`), после вставки последовательность подтягивается `setval`. Так строка конфига пишется в том же батче, что и пиксели, и проверку «stale» делает единственный писатель без гонок.
- **Запись в `mod_log` идёт двумя путями.** Бан пишется прямой транзакцией вместе с `users`, потому что это не состояние движка. Правка игрока и конфиг пишутся событием движка в group commit. Действия: `ban`, `unban`, `player_edit`, `config_save`, `config_rollback`.
- **`PlayerView.access` заменяется на `blocks`** (массив всех причин по порядку) и `banReason`. `effectiveAccess` на клиенте отбрасывает истёкшие причины и возвращает первую оставшуюся или `"ok"`.

```
 /admin (lazy chunk, zod) ──tRPC admin.* (adminProcedure: user + isAdmin)──┐
                                                                           ▼
   players.search/get ──► users + engine state + mod_log (read)
   players.ban/unban  ──► DB tx: users.banned_until/ban_reason + mod_log
                          └─► runtime.run: engine.setAccess → event player ─┐
   players.adjust     ──► runtime.run: engine.adminAdjust                   │
                          → ledger(admin) + mod_log + player ───────────────┤
   config.save/rollback ► zod parse → runtime.run: engine.applyConfig       │
                          (stale? canvas shrink? used colors?)              │
                          → swap cfg, canvas.resize                         │
                          → config_changed + mod_log ───────────────────────┤
                                                                            ▼
                                            group commit (one transaction) ─► Hub.handleCommit
                                              ├─ player → user topic: PlayerView (blocks, banReason)
                                              └─ config_changed → global: {type:"config"}
                                                 + fresh PlayerView to every online user
 web game: gameStore.setConfig → renderer palette/size, camera, minimap; AccessBanner; admin link
```

## Файлы

Сервер и общие:
- Modify `apps/server/src/net/env.ts` (+test): `ADMIN_DISCORD_IDS` → `adminDiscordIds`.
- Create `apps/server/src/auth/admin.ts` (+test).
- Modify `apps/server/src/auth/session.ts` (+test): `discordId` и `banReason` в `SessionUser`.
- Modify `apps/server/src/engine/types.ts`, `engine.ts`, `access.ts`, `player.ts`, `canvas-store.ts` (+tests).
- Create `apps/server/src/engine/config-change.ts` (+test), `apps/server/src/engine/engine.admin.test.ts`, `engine.config.test.ts`.
- Modify `apps/server/src/persistence/load-game.ts`, `write-batch.ts`, `runtime.ts` (+ tests, `restart.test.ts`).
- Modify `apps/server/src/db/schema.ts`; Create `apps/server/drizzle/0002_*.sql` (индексы `mod_log`).
- Modify `apps/server/src/net/views.ts`, `hub.ts`, `overview.ts`, `server.ts`, `deps.ts` (+tests).
- Create `apps/server/src/admin/service.ts` (+test).
- Modify `apps/server/src/trpc/init.ts`, `router.ts` (+test).
- Modify `apps/server/src/stats/leaderboards.ts`, `profiles.ts` (+tests).
- Modify `apps/server/src/main.ts`, `apps/server/src/scripts/push-default-config.ts`.
- Modify `packages/shared/src/protocol.ts`.
- Modify `.env.example`, если в нём есть список переменных.

Клиент:
- Modify `apps/web/src/game/access.ts` (+test) и фикстуры `PlayerView` в тестах.
- Modify `apps/web/src/state/game-store.ts` (+test), `apps/web/src/canvas/session.ts`, `controller.ts` (+test).
- Create `apps/web/src/ui/AccessBanner.tsx` и `.module.css`.
- Modify `apps/web/src/App.tsx`, `App.module.css`, `apps/web/src/ui/AuthPanel.tsx`, `ProfileTab.tsx`, `apps/web/src/main.tsx`.
- Create в `apps/web/src/admin/`:
  - `AdminApp.tsx`, `admin.module.css`;
  - `PlayersSection.tsx`, `PlayerCard.tsx`;
  - `ConfigSection.tsx`, `PaletteTable.tsx`, `ConfigHistory.tsx`;
  - `ModLogSection.tsx`;
  - `config-draft.ts` (+test), `ban.ts` (+test), `labels.ts`.
- Modify `docs/superpowers/plans/2026-10-07-00-roadmap.md`.

Проверки из корня: `bun test` (Postgres: `bun run db:up`), `bun run typecheck`, `bun run build:web`.

---

### Task 1: Доступ админа на сервере

**Files:** Modify `apps/server/src/net/env.ts`, `env.test.ts`, `apps/server/src/auth/session.ts`, `session.test.ts`, `apps/server/src/trpc/init.ts`, `router.ts`, `router.test.ts`, `apps/server/src/net/hub.ts`, `server.test.ts`, `packages/shared/src/protocol.ts`; Create `apps/server/src/auth/admin.ts`, `admin.test.ts`

- [ ] **Step 1: env.** Добавь в `envSchema` поле
  ```ts
  ADMIN_DISCORD_IDS: z.string().default("").refine(
    (v) => v.split(",").map((s) => s.trim()).filter(Boolean).every((s) => /^\d+$/.test(s)),
    { message: "comma-separated numeric Discord ids" },
  )
  ```
  - В `ServerConfig` — `adminDiscordIds: Set<string>` (обрезанные, без пустых).
  - Тест в `env.test.ts`: `"1, 2,,3"` → `Set{"1","2","3"}`; `"abc"` → ошибка; пусто → пустой Set.
  - Во всех тестовых `ServerConfig` (`router.test.ts`, `server.test.ts`, …) добавь `adminDiscordIds: new Set()`.
  - Найди их так: `grep -rn "sessionTtlMs:" apps/server/src`.

- [ ] **Step 2: `SessionUser`.** Добавь `discordId: string` и `banReason: string | null`. `resolveSession` выбирает `users.discordId` и `users.banReason`. Обнови `sessionUser(...)` в тестах: `discordId: \`discord-${username}\``, `banReason: null`. В `session.test.ts` проверь, что `resolveSession` возвращает `discordId`.

- [ ] **Step 3: `auth/admin.ts`.**
  ```ts
  import type { ServerConfig } from "../net/env";
  import { DEV_ADMIN_DISCORD_ID } from "./dev-admin";

  /** Admin rights come only from the server config; the client flag is for showing links. */
  export function isAdmin(discordId: string, config: Pick<ServerConfig, "adminDiscordIds" | "devLogin">): boolean {
    return config.adminDiscordIds.has(discordId) || (config.devLogin && discordId === DEV_ADMIN_DISCORD_ID);
  }
  ```
  Тест покрывает четыре случая: id в списке → true; `dev:admin` при `devLogin` → true; `dev:admin` без `devLogin` → false; чужой id → false.

- [ ] **Step 4: `adminProcedure` в `trpc/init.ts`.**
  ```ts
  /** Admins only. Queries go over GET like public ones (the browser's CORS keeps their answers same-origin); mutations get the Origin check. */
  export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
    const user = ctx.user;
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (!isAdmin(user.discordId, ctx.deps.config)) throw new TRPCError({ code: "FORBIDDEN" });
    if (!ctx.limiter.take(user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    return next({ ctx: { ...ctx, user } });
  });
  ```
  В `router.ts` заведи `admin: router({ whoami: publicProcedure.query(({ ctx }) => ({ admin: ctx.user !== null && isAdmin(ctx.user.discordId, ctx.deps.config) })) })`. Остальные процедуры добавит Task 7.

  Тесты в `router.test.ts`:
  - `whoami` для анонима, alice и админа (при `adminDiscordIds: new Set(["discord-admin"])`).
  - Временная процедура не нужна: проверка FORBIDDEN появится в Task 7 на реальных процедурах.

- [ ] **Step 5: `hello.admin`.** В `protocol.ts` добавь в `hello` поле `admin: boolean` с комментарием «Whether to show admin links; every admin call is checked on the server».
  - `HubOptions` получает `isAdmin?: (user: SessionUser) => boolean` (по умолчанию `() => false`).
  - В `open` передавай `admin: user !== null && this.isAdmin(user)`.
  - В `main.ts`: `new Hub({ runtime, users, isAdmin: (u) => isAdmin(u.discordId, config) })`.
  - Тест в `server.test.ts`: hello админа содержит `admin: true`, у обычного игрока — `false`.

- [ ] **Step 6:** `bun test apps/server packages && bun run typecheck` → PASS. Commit: `feat(server): admin access from ADMIN_DISCORD_IDS and dev admin`.

---

### Task 2: Бан в движке, все причины доступа, `PlayerView.blocks` и `banReason`

**Files:** Modify `apps/server/src/engine/types.ts`, `player.ts`, `access.ts`, `engine.ts`, `engine.access.test.ts`, `apps/server/src/persistence/load-game.ts`, `load-game.test.ts`, `apps/server/src/trpc/init.ts`, `apps/server/src/net/hub.ts`, `views.ts`, `views.test.ts`, `packages/shared/src/protocol.ts`, `apps/server/src/auth/discord-routes.ts`

- [ ] **Step 1: Состояние.**
  - `PlayerState.banReason: string | null`.
  - `NewPlayer.banReason?: string | null`; `createPlayer` ставит `init.banReason ?? null`.
  - `loadPlayers` выбирает `users.banReason`.
  - `addPlayer` в `playerProcedure` и `Hub.open` передаёт `banReason: user.banReason`.
  - Не забудь `makeEngine.addPlayer` в `test-utils.ts`: поле опциональное, так что правки там не нужны.

- [ ] **Step 2: Все причины.** В `access.ts`:
  ```ts
  export type AccessBlock = "banned" | "not_guild_member" | "account_too_new";

  /** Every reason the player may only watch right now, most important first. Freeze is checked separately. */
  export function accessBlocks(p: PlayerState, cfg: GameConfig, now: number): AccessBlock[] {
    const blocks: AccessBlock[] = [];
    if (p.bannedUntil !== null && p.bannedUntil > now) blocks.push("banned");
    if (!p.guildMember) blocks.push("not_guild_member");
    if (now - p.accountCreatedAt < cfg.access.minAccountAgeDays * DAY_MS) blocks.push("account_too_new");
    return blocks;
  }

  export function accessError(p: PlayerState, cfg: GameConfig, now: number): AccessBlock | null {
    return accessBlocks(p, cfg, now)[0] ?? null;
  }
  ```

- [ ] **Step 3: `setAccess` пушит обновление.** Расширь сигнатуру: `setAccess(userId, access: { guildMember?: boolean; bannedUntil?: number | null; banReason?: string | null })`. В конце добавь `this.emit({ type: "player", userId })`. Комментарий «no events» замени на: «Flags live in `users`; the `player` event only pushes the new view (the persister upserts unchanged state)».

  Тест в `engine.access.test.ts`: `setAccess(1, { bannedUntil: T0 + 1000, banReason: "spam" })`:
  - в `drainEvents()` есть ровно одно `{type:"player", userId:1}`;
  - `placePixel` → `banned`;
  - после `setAccess(1, { bannedUntil: null, banReason: null })` пиксель ставится.

- [ ] **Step 4: `PlayerView`.** В `protocol.ts` замени `access` на:
  ```ts
  /** Why the player may only watch, most important first; empty = may play. Freeze is separate. Re-check expiry on the client. */
  blocks: Array<"banned" | "not_guild_member" | "account_too_new">;
  /** Shown to a banned player. */
  banReason: string | null;
  ```
  - `toPlayerView`: `const blocks = accessBlocks(p, cfg, now)`.
  - `playableAt` считается, если `blocks.includes("account_too_new")`.
  - `banReason: blocks.includes("banned") ? p.banReason : null`.

  Тесты в `views.test.ts`:
  - бан + не в гильдии → `blocks` равен `["banned","not_guild_member"]`, `banReason` передан;
  - без бана `banReason` равен `null`, даже если в состоянии осталась старая причина.

- [ ] **Step 5:** `discord-routes.ts` вызывает `setAccess` внутри `runtime.run`, поэтому событие запишется. Проверь, что `discord-routes.test.ts` проходит. Если тест считает события, обнови его.

- [ ] **Step 6:** `bun test apps/server packages && bun run typecheck` → PASS. Typecheck клиента пока упадёт на `access`: это нормально, Task 9 его чинит. Проверяй только `tsc -p tsconfig.json`. Commit: `feat(server): ban reason, all access blocks in the player view, pushed access changes`.

---

### Task 3: Правка игрока в движке и событие `mod_log`

**Files:** Modify `apps/server/src/engine/types.ts`, `engine.ts`, `apps/server/src/persistence/write-batch.ts`, `write-batch.test.ts`, `apps/server/src/db/schema.ts`; Create `apps/server/src/engine/engine.admin.test.ts`

- [ ] **Step 1: Типы.**
  ```ts
  export type LedgerReason = "shop" | "daily" | "explosion" | "bomb_bonus" | "defuse" | "use" | "admin";
  export type ModAction = "ban" | "unban" | "player_edit" | "config_save" | "config_rollback";
  // EngineEvent:
  | { type: "mod_log"; adminId: UserId; action: ModAction; targetUserId: UserId | null; params: Record<string, unknown>; at: number }
  export type AdjustResult = { ok: true } | { ok: false; code: "nothing_to_change" | "negative_balance" };
  ```
  В `schema.ts`: `ledger.reason` уже допускает `"admin"` через `LedgerReason | "start" | "admin"`. Упрости до `LedgerReason | "start"`. `modLog.action` типизируй как `text("action").$type<ModAction>()`.

- [ ] **Step 2: Тест `engine.admin.test.ts`.**
  ```ts
  import { describe, expect, test } from "bun:test";
  import { eventsOf, makeEngine, T0 } from "./test-utils";

  describe("adminAdjust", () => {
    test("applies every delta, writes admin ledger rows and one mod_log entry", () => {
      const { engine, addPlayer } = makeEngine();
      const p = addPlayer(1);
      const coins = p.coins;
      const result = engine.adminAdjust(1, { coins: 500, bomb: -1, detector: 0 }, T0, { adminId: 9, comment: "compensation" });
      expect(result).toEqual({ ok: true });
      expect(p.coins).toBe(coins + 500);
      const events = engine.drainEvents();
      expect(eventsOf(events, "ledger").map((e) => [e.item, e.delta, e.reason, e.ref])).toEqual([
        ["coins", 500, "admin", { adminId: 9, comment: "compensation" }],
        ["bomb", -1, "admin", { adminId: 9, comment: "compensation" }],
      ]);
      expect(eventsOf(events, "mod_log")).toEqual([
        { type: "mod_log", adminId: 9, action: "player_edit", targetUserId: 1, params: { changes: { coins: 500, bomb: -1 }, comment: "compensation" }, at: T0 },
      ]);
      expect(eventsOf(events, "player")).toEqual([{ type: "player", userId: 1 }]);
    });

    test("rejects a change that would go below zero and changes nothing", () => {
      const { engine, addPlayer } = makeEngine();
      const p = addPlayer(1);
      const before = structuredClone({ coins: p.coins, inventory: p.inventory });
      expect(engine.adminAdjust(1, { coins: 10, bomb: -(p.inventory.bomb + 1) }, T0, { adminId: 9, comment: "x" })).toEqual({ ok: false, code: "negative_balance" });
      expect({ coins: p.coins, inventory: p.inventory }).toEqual(before);
      expect(engine.drainEvents()).toEqual([]);
    });

    test("rejects an all-zero change", () => {
      const { engine, addPlayer } = makeEngine();
      addPlayer(1);
      expect(engine.adminAdjust(1, { coins: 0 }, T0, { adminId: 9, comment: "x" })).toEqual({ ok: false, code: "nothing_to_change" });
    });
  });
  ```

- [ ] **Step 3: Реализация в `engine.ts`.**
  ```ts
  /** Moderator balance change. All deltas apply or none; balances never go below zero. */
  adminAdjust(userId: UserId, changes: Partial<Record<LedgerItem, number>>, now: number, meta: { adminId: UserId; comment: string }): AdjustResult {
    const p = this.players.get(userId);
    const entries = (Object.entries(changes) as Array<[LedgerItem, number]>).filter(([, delta]) => delta !== 0);
    if (entries.length === 0) return { ok: false, code: "nothing_to_change" };
    const balance = (item: LedgerItem) => (item === "coins" ? p.coins : p.inventory[item]);
    if (entries.some(([item, delta]) => balance(item) + delta < 0)) return { ok: false, code: "negative_balance" };
    for (const [item, delta] of entries) {
      if (item === "coins") p.coins += delta;
      else p.inventory[item] += delta;
      this.ledger(p, item, delta, "admin", now, { adminId: meta.adminId, comment: meta.comment });
    }
    this.emit({ type: "mod_log", adminId: meta.adminId, action: "player_edit", targetUserId: userId, params: { changes: Object.fromEntries(entries), comment: meta.comment }, at: now });
    this.emit({ type: "player", userId });
    return { ok: true };
  }
  ```
  Порядок записей в `ledger` совпадает с порядком ключей во входе. Тест рассчитывает на `coins`, затем `bomb`.

- [ ] **Step 4: Запись `mod_log`.**
  - В `write-batch.ts` добавь `"mod_log"` в `assertKnownEvents`.
  - Заведи `insertModLog`: многострочная вставка в `modLog` с `createdAt: new Date(e.at)`. Вызывай его после `insertLedger`.
  - Тест в `write-batch.test.ts`: батч с событием `mod_log` создаёт строку с нужными `action`, `targetUserId`, `params`.

- [ ] **Step 5:** `bun test apps/server && tsc -p tsconfig.json` → PASS. Commit: `feat(server): moderator balance edits with admin ledger rows and mod_log events`.

---

### Task 4: Живой конфиг в движке — версии, кросс-версионная проверка, рост холста

**Files:** Modify `apps/server/src/engine/canvas-store.ts`, `canvas-store.test.ts`, `types.ts`, `engine.ts`, `test-utils.ts`, `apps/server/src/persistence/load-game.ts`, `load-game.test.ts`, `write-batch.ts`, `write-batch.test.ts`, `restart.test.ts`; Create `apps/server/src/engine/config-change.ts`, `config-change.test.ts`, `engine.config.test.ts`

- [ ] **Step 1: Счётчики цветов в `CanvasStore`.**
  - Поле `private colorCounts = new Float64Array(256)` считает клетки ненулевых цветов в загруженных чанках.
  - `set`: `-1` для `prev.colorId`, `+1` для нового, только для ненулевых.
  - `loadChunk`: вычесть цвета старого чанка и прибавить цвета нового.
  - Метод `colorCount(colorId)`: для `0` возвращает `width*height - сумма ненулевых`, иначе `colorCounts[colorId]`.
  - Тест: `set` ×3 разными цветами и перекрытие → счётчики сходятся; `loadChunk` заменяет вклад старого чанка; `colorCount(0)` на пустом холсте 512² даёт 262144.

- [ ] **Step 2: `config-change.ts` — проверка перехода.**
  ```ts
  import type { GameConfig } from "@rave/shared";
  import type { CanvasStore } from "./canvas-store";

  export interface ConfigIssue {
    /** Dotted path like zod's: "canvas.width", "palette". */
    path: string;
    message: string;
  }

  /** Rules a valid config must also satisfy relative to the live game (spec 6). */
  export function configChangeIssues(prev: GameConfig, next: GameConfig, canvas: CanvasStore): ConfigIssue[] {
    const issues: ConfigIssue[] = [];
    if (next.canvas.width < canvas.width) issues.push({ path: "canvas.width", message: `Холст может только расти (сейчас ${canvas.width})` });
    if (next.canvas.height < canvas.height) issues.push({ path: "canvas.height", message: `Холст может только расти (сейчас ${canvas.height})` });
    const nextById = new Map(next.palette.map((e) => [e.id, e]));
    for (const entry of prev.palette) {
      const used = canvas.colorCount(entry.id);
      if (used === 0) continue;
      const replacement = nextById.get(entry.id);
      if (!replacement) issues.push({ path: "palette", message: `Цвет ${entry.id} есть на холсте (${used} пикс.) — удалить нельзя` });
      else if (replacement.type !== entry.type) issues.push({ path: "palette", message: `Цвет ${entry.id} есть на холсте — менять его тип нельзя` });
    }
    return issues;
  }
  ```
  Тесты:
  - уменьшение ширины → ошибка по пути `canvas.width`;
  - удаление неиспользованного цвета 40 → ок;
  - удаление цвета 40 после `canvas.set(…, 40, …)` → ошибка;
  - смена `type` у используемого → ошибка;
  - смена `base` или `price` у используемого → ок.

- [ ] **Step 3: Типы движка.**
  ```ts
  // EngineEvent:
  | { type: "config_changed"; version: number; config: GameConfig; createdBy: UserId; comment: string; at: number }
  export type ConfigResult =
    | { ok: true; version: number }
    | { ok: false; code: "stale"; currentVersion: number }
    | { ok: false; code: "invalid"; issues: ConfigIssue[] };
  ```

- [ ] **Step 4: Тест `engine.config.test.ts`.**
  1. Успешное применение: версия 1 → 2.
     - `engine.config` — новый объект;
     - `engine.configVersion === 2`;
     - в событиях `config_changed` с версией 2 и `mod_log` (`config_save`, `targetUserId: null`, `params: { version: 2, comment }`).
  2. `baseVersion` 0 при текущей 1 → `{ok:false, code:"stale", currentVersion:1}`, конфиг не тронут, событий нет.
  3. Рост холста 512→768 по ширине:
     - `canvas.width === 768`;
     - `placePixel` на `x=600` проходит;
     - в событиях есть `config_changed`.
  4. Уменьшение холста → `invalid`.
  5. Ограничения поверх нового конфига: `charges.max` снижен с 10 до 3 у игрока с 10 зарядами → после `placePixel` у игрока 2 заряда.
  6. Откат: `action: "config_rollback"` с `fromVersion: 1` → `mod_log.params` содержит `fromVersion: 1`.

- [ ] **Step 5: Реализация в `engine.ts`.**
  - Конструктор получает 6-й параметр `private _configVersion = 1`.
  - Добавь геттер `get configVersion(): number`.
  ```ts
  /**
   * Swaps the live config. `next` must already pass gameConfigSchema; this adds the rules that depend on
   * the running game, and rejects saves based on an outdated version. Persisted with the same batch as pixels.
   */
  applyConfig(
    next: GameConfig,
    change: { baseVersion: number; adminId: UserId; comment: string; action: "config_save" | "config_rollback"; fromVersion?: number },
    now: number,
  ): ConfigResult {
    if (change.baseVersion !== this._configVersion) return { ok: false, code: "stale", currentVersion: this._configVersion };
    const issues = configChangeIssues(this.cfg, next, this.canvas);
    if (issues.length > 0) return { ok: false, code: "invalid", issues };
    this.canvas.resize(next.canvas.width, next.canvas.height);
    this.cfg = next;
    const version = ++this._configVersion;
    this.emit({ type: "config_changed", version, config: next, createdBy: change.adminId, comment: change.comment, at: now });
    this.emit({
      type: "mod_log",
      adminId: change.adminId,
      action: change.action,
      targetUserId: null,
      params: { version, comment: change.comment, ...(change.fromVersion !== undefined ? { fromVersion: change.fromVersion } : {}) },
      at: now,
    });
    return { ok: true, version };
  }
  ```
  `resize` при равных размерах ничего не меняет; это проверено в `CanvasStore.resize`.

- [ ] **Step 6: Загрузка и запись.**
  - `loadConfig` возвращает `{ config, version }`, `loadGame` передаёт `version` в `new GameEngine(..., version)`. Посев в пустую таблицу делает `returning({ version })`.
  - `write-batch.ts`:
    - добавь `"config_changed"` в `assertKnownEvents`;
    - `insertConfigVersions` вставляет `{ version, data: config, createdBy, comment, createdAt }` в `gameConfig`;
    - если вставлялось, выполни `select setval(pg_get_serial_sequence('game_config', 'version'), (select max(version) from game_config))`;
    - вызывай `insertConfigVersions` первым шагом после новых игроков, до пикселей.
  - Тест в `write-batch.test.ts`: строка с версией 2 записана; следующая вставка без версии получает 3, то есть последовательность сдвинута.

- [ ] **Step 7: `restart.test.ts`.** Сценарий: `bootGame` → `applyConfig` с шириной 768 → `placePixel` на `x=700` → `runtime.stop()`. Новый `bootGame` должен дать:
  - `engine.config.canvas.width === 768`;
  - `engine.configVersion === 2`;
  - клетка `(700, y)` с нужным цветом и владельцем.

- [ ] **Step 8:** `bun test apps/server && tsc -p tsconfig.json` → PASS. Commit: `feat(server): versioned live config changes with canvas growth and used-color checks`.

---

### Task 5: Рассылка конфига и обновления после коммита

**Files:** Modify `packages/shared/src/protocol.ts`, `apps/server/src/net/hub.ts`, `overview.ts`, `overview.test.ts`, `server.test.ts`

- [ ] **Step 1: Протокол.** В `ServerMessage` добавь `| { type: "config"; config: GameConfig }` с комментарием «The live config changed; replaces the one from hello. Canvas size may grow».

- [ ] **Step 2: Hub.** В `handleCommit`:
  ```ts
  const configChange = events.findLast((e) => e.type === "config_changed");
  if (configChange) {
    server.publish(GLOBAL_TOPIC, JSON.stringify({ type: "config", config: configChange.config } satisfies ServerMessage));
    // Charge caps and access depend on the config: every online player gets a fresh view.
    for (const ws of this.sockets) if (ws.data.ready && ws.data.user) touched.add(ws.data.user.id);
  }
  ```
  Вставь это после заполнения `touched` и до цикла рассылки `player`. Если `findLast` недоступен в целевом `lib`, используй обратный цикл.

  Тест в `server.test.ts`:
  - два WS-клиента (аноним и alice);
  - `runtime.run(e => e.applyConfig(...))` с увеличенной ценой бомбы;
  - оба получают `{type:"config"}` с новой ценой;
  - alice получает ещё и `player`.

- [ ] **Step 3: Обзор при росте холста.** `OverviewCache.get` должен перестраивать картинку и при смене размера холста: храни `width`/`height`, из которых собран `body`. Тест в `overview.test.ts`: после `canvas.resize` сразу (без ожидания 5 с) приходит обзор новой формы.

- [ ] **Step 4:** `bun test apps/server packages && tsc -p tsconfig.json` → PASS. Commit: `feat(server): broadcast config changes and refresh player views`.

---

### Task 6: Единый источник банов и недостающие тесты статистики

**Files:** Modify `apps/server/src/stats/leaderboards.ts`, `leaderboards.test.ts`, `profiles.ts`, `profiles.test.ts`, `apps/server/src/trpc/router.test.ts`

- [ ] **Step 1: Рейтинги.**
  - В `fromStats` убери `innerJoin(users)` и условие по `users.bannedUntil`.
  - После запроса отфильтруй строки через `this.isBanned(userId, now)` и только потом ранжируй.
  ```ts
  /** Bans come from the engine: moderation updates it together with users, and every player with stats is loaded there. */
  private isBanned(userId: number, now: number): boolean {
    const players = this.runtime.engine.players;
    return players.has(userId) && (players.get(userId).bannedUntil ?? 0) > now;
  }
  /** Drops cached rankings, e.g. after a ban or unban. */
  invalidate(): void {
    this.cache.clear();
  }
  ```
  `territory()` тоже использует `isBanned`. Тест в `leaderboards.test.ts`:
  - бан через `engine.setAccess` скрывает игрока после `invalidate()`, без ожидания 30 с;
  - `users.banned_until` без движка больше ни на что не влияет: это фиксирует единый источник.

- [ ] **Step 2: Профили.** `banned` берётся из движка, если игрок там есть, иначе из `users.bannedUntil`. Тесты в `profiles.test.ts`:
  - **Нет лишних ключей.** `Object.keys(profile).sort()` равен `["activeBombs","banned","favoriteColor","heatmap","joinedAt","territory","totals","user"]`. Ключи `heatmap`, `totals` и `user` проверяются так же (спека 9.5: никаких координат бомб, монет и инвентаря).
  - **Тепловая карта на выросшем неквадратном холсте.** `engine.applyConfig` до 768×512, пиксели в `(700, 10)` и `(10, 500)`. Ожидаются `heatmap.step === 12` (`ceil(768/64)`), `width === 64`, `height === 43` (`ceil(512/12)`), а `cells` равны `[[58, 1], [2624, 1]]` в любом порядке: `(700,10)` → `0*64 + 58`, `(10,500)` → `41*64 + 0`.

- [ ] **Step 3: Топ-50 и `me` вне топа** (`router.test.ts`). Вставь 55 пользователей со строками `stats_daily.pixels = 100 - i`; alice — со значением 1. Ожидания:
  - `top.length === 50`;
  - `top[0].value === 100`;
  - alice нет в `top`;
  - `me` alice равен `{ rank: 56, value: 1 }`, а у анонима `me === null`.

- [ ] **Step 4:** `bun test apps/server` → PASS. Commit: `fix(server): one ban source for stats, cache reset hook, missing stats tests`.

---

### Task 7: Админ-сервис и `admin.*` в tRPC

**Files:** Create `apps/server/src/admin/service.ts`, `service.test.ts`; Modify `apps/server/src/db/schema.ts`, `apps/server/drizzle/*` (генерация), `apps/server/src/net/deps.ts`, `apps/server/src/main.ts`, `apps/server/src/trpc/router.ts`, `router.test.ts`

- [ ] **Step 1: Индексы `mod_log`.** В `schema.ts` добавь:
  ```ts
  (t) => [index("mod_log_target_idx").on(t.targetUserId, t.id), index("mod_log_action_idx").on(t.action, t.id)]
  ```
  Затем `bun run --cwd apps/server db:generate`, проверь SQL в новом `0002_*.sql` (только `CREATE INDEX`) и закоммить его вместе с `meta`.

- [ ] **Step 2: `AdminService`.** Зависимости: `db`, `runtime`, `users: UserDirectory`, `stats: StatsService`, `isAdmin: (discordId) => boolean`, `now`. Методы:

  ```ts
  search(q: string): Promise<Array<{ id: number; name: string; discordId: string; banned: boolean }>>
  ```
  - `q` обрезается, длина 1..64.
  - Условия через `or`: `username ilike %q%`, где `%`, `_` и `\` экранированы; `id = q`, если `q` — целое в 1..2147483647; `discord_id = q`.
  - Сортировка по `id`, лимит 20. `banned` берётся из `banned_until > now`.

  ```ts
  player(userId: number): Promise<AdminPlayer | null>
  ```
  - `user`: `id`, `name`, `discordId`, `createdAt`, `discordCreatedAt`, `lastSeenAt`, `guildMember`, `bannedUntil` (число / `"permanent"` / `null`), `banReason`.
  - `state`: `null`, если игрока нет в движке; иначе `coins`, `inventory`, `charges` (settled на копии, как во `toPlayerView`), `chargeCap`, `frozenUntil`, `unlimited`, `activeBombs`, `territory`.
  - `log`: последние 20 записей `mod_log` по `targetUserId`, в формате `ModLogEntry` (см. ниже).

  ```ts
  ban(admin: SessionUser, input: { userId: number; until: number | "permanent"; reason: string }): Promise<AdminActionResult>
  ```
  1. Проверки: цель существует (иначе `not_found`), это не сам админ (`self`), цель не админ по `discordId` (`target_is_admin`), `until > now` (`bad_until`).
  2. `db.transaction`: обновить `users` (`bannedUntil: banToDate(...)`, `banReason`) и вставить `mod_log` (`action: "ban"`, `params: { until, reason }`).
  3. `runtime.run((e) => { if (e.players.has(id)) e.setAccess(id, { bannedUntil, banReason }) })`.
  4. `stats.leaderboards.invalidate()`.

  ```ts
  unban(admin, input: { userId: number; reason: string }): Promise<AdminActionResult>
  ```
  Работает симметрично: в `users` пишется `null`/`null`, в `mod_log` — `action: "unban"`, `params: { reason }`. Если цель не забанена, возвращается `not_banned`.

  ```ts
  adjust(admin, input: { userId; changes: Partial<Record<"coins"|ItemKey, number>>; comment }): Promise<AdminActionResult>
  ```
  Если игрока нет в движке, возвращается `not_found` с сообщением «ещё не заходил». Иначе вызывается `runtime.run((e, now) => e.adminAdjust(...))`, а его коды пробрасываются наружу.

  ```ts
  modLog(input: { action?: ModAction; targetUserId?: number; before?: number }): Promise<{ entries: ModLogEntry[]; next: number | null }>
  ```
  Сортировка по `id desc`, `limit 51`. Курсор — `before` (`id < before`); `next` — id 50-й записи, если пришла 51-я.
  `ModLogEntry = { id, admin: UserRef, action, target: UserRef | null, params, at }` (имена берутся из `UserDirectory`).

  ```ts
  currentConfig(): { version: number; config: GameConfig }
  history(): Promise<Array<{ version; createdBy: UserRef | null; comment; createdAt }>>
  configVersion(version: number): Promise<GameConfig | null>
  ```
  - `currentConfig` берётся из движка.
  - `history` — последние 50 версий.
  - `configVersion` возвращает `data` версии.

  ```ts
  saveConfig(admin, input: { baseVersion: number; config: unknown; comment: string }): Promise<ConfigAnswer>
  rollbackConfig(admin, input: { version: number; baseVersion: number; comment: string }): Promise<ConfigAnswer>
  ```
  - `ConfigAnswer` = `ConfigResult` | `{ ok: false; code: "not_found" }`.
  - `saveConfig`: `gameConfigSchema.safeParse(input.config)`. При ошибке — `{ ok:false, code:"invalid", issues }`, где пути zod склеены через точку.
  - Если схема прошла, `runtime.run((e, now) => e.applyConfig(parsed, { …, action: "config_save" }, now))`.
  - `rollbackConfig` читает старую версию (иначе `not_found`) и прогоняет её тем же путём с `action: "config_rollback"` и `fromVersion`.
  - Старая версия может не пройти текущую схему или проверки — тогда `invalid`.

  `AdminActionResult = { ok: true } | { ok: false; code: "not_found" | "self" | "target_is_admin" | "bad_until" | "not_banned" | "nothing_to_change" | "negative_balance" }`.

- [ ] **Step 3: Тесты `service.test.ts`** (тестовая БД, `bootGame`, без Hub).
  - **Поиск.** Находит по части имени, по id и по `discord_id`. `%` в запросе не работает как маска.
  - **Бан.**
    - После бана в `users` есть дата и причина;
    - в `mod_log` одна строка `ban`;
    - в движке стоит `bannedUntil` и `banReason`;
    - `placePixel` отклоняется с `banned`;
    - рейтинг без игрока виден сразу, без ожидания 30 с.
  - **Отказы бана.** `self`, `target_is_admin`, `bad_until` (время в прошлом). Бан игрока, которого нет в движке, пишется только в БД; после `addPlayer` с `SessionUser` из `resolveSession` он забанен.
  - **Разбан.** Пишет `null`/`null`, `mod_log` получает `unban`. Повторный разбан возвращает `not_banned`.
  - **`adjust`.** Записи в `ledger` с `reason=admin`, `mod_log` с `player_edit`. Если игрока нет в движке, возвращается `not_found`.
  - **`saveConfig`.**
    - невалидный JSON (`charges.max: -1`) → `invalid` с путём `charges.max`;
    - устаревшая `baseVersion` → `stale`;
    - успех → новая строка в `game_config` с `created_by` и `comment`, плюс запись `config_save` в `mod_log`.
  - **`rollbackConfig`.** Откат к версии 1 создаёт версию 3 с данными версии 1.
  - **`modLog`.** 60 записей → первая страница 50 и `next`, вторая 10 и `next: null`. Фильтр по `action` и по `targetUserId` работает.

- [ ] **Step 4: Подключение.**
  - `AppDeps.admin: AdminService`.
  - В `main.ts`: `new AdminService({ db, runtime, users, stats, isAdmin: (id) => isAdmin(id, config) })`.
  - В `router.ts` заполни `admin`:
    - `whoami` (уже есть);
    - `players.search`: query, input `{ q: z.string().trim().min(1).max(64) }`;
    - `players.get`: query, `{ userId: id }`; при `null` бросает `NOT_FOUND`;
    - `players.ban`: mutation, `{ userId, until: z.union([z.number().int().positive(), z.literal("permanent")]), reason: z.string().trim().min(1).max(200) }`;
    - `players.unban`: mutation, `{ userId, reason: z.string().trim().min(1).max(200) }`;
    - `players.adjust`: mutation, `{ userId, changes: z.object({ coins, bomb, detector, defuser — z.number().int().min(-1_000_000).max(1_000_000).optional() }), comment: 1..200 }`;
    - `modLog`: query, `{ action?: z.enum(MOD_ACTIONS), targetUserId?: id, cursor?: z.number().int().positive().nullish() }` (имя `cursor` нужно для `useInfiniteQuery`; роутер передаёт его в сервис как `before`);
    - `config.current`, `config.history` — query;
    - `config.get`: query, `{ version }`;
    - `config.save`: mutation, `{ baseVersion, config: z.unknown(), comment: 1..200 }`;
    - `config.rollback`: mutation, `{ version, baseVersion, comment }`.
  - `MOD_ACTIONS` экспортируется из `engine/types.ts` как `as const`.
  - Все процедуры, кроме `whoami`, используют `adminProcedure`. Мутации возвращают результат сервиса как есть.
  - В `router.test.ts` заведи `admin` (`discordId: "discord-admin"`, `adminDiscordIds: new Set(["discord-admin"])`) и проверь:
    - alice получает `FORBIDDEN` на `admin.players.search` и `admin.config.save`;
    - аноним получает `UNAUTHORIZED`;
    - админ банит bob, и `me` bob содержит `blocks: ["banned"]` и `banReason`;
    - выдача `config.current` проходит `gameConfigSchema.parse`.

- [ ] **Step 5:** `bun test apps/server && tsc -p tsconfig.json` → PASS. Commit: `feat(server): admin service and tRPC admin procedures`.

---

### Task 8: `config:defaults` — только посев в пустую таблицу

**Files:** Modify `apps/server/src/scripts/push-default-config.ts`

- [ ] **Step 1:** Перепиши логику:
  - если в `game_config` есть хотя бы одна строка, выведи `Config already exists (version N). Edit it in /admin.` и выйди с кодом 0;
  - иначе вставь `defaultConfig` с `comment: "defaults from code"`.

  Проверку `--yes` в production оставь. Комментарий файла: «Seeds the defaults into an empty game_config; the running config is edited in /admin».

- [ ] **Step 2:** Прогони вручную на dev-БД: `bun run config:defaults` → сообщение «already exists». Commit: `chore(server): config:defaults only seeds an empty table`.

---

### Task 9: Клиент — причины доступа, баннер, живой конфиг, флаг админа

**Files:** Modify `apps/web/src/game/access.ts`, `access.test.ts`, тестовые фикстуры `PlayerView` (`tools.test.ts`, `placement.test.ts`, `client.test.ts`, `game-store.test.ts` и все, что найдёт `grep -rln "serverNow:" apps/web/src`), `apps/web/src/state/game-store.ts`, `game-store.test.ts`, `apps/web/src/canvas/session.ts`, `controller.ts`, `controller.test.ts`, `apps/web/src/App.tsx`; Create `apps/web/src/ui/AccessBanner.tsx`, `AccessBanner.module.css`

- [ ] **Step 1: `effectiveAccess`.**
  ```ts
  type Block = PlayerView["blocks"][number];
  /** The first block still in force: a temporary ban or a too-new account may have expired since the view was built. */
  export function effectiveAccess(p: Pick<PlayerView, "blocks" | "bannedUntil" | "playableAt">, now: number): Block | "ok" {
    const live = p.blocks.filter((b) => {
      if (b === "banned") return !(typeof p.bannedUntil === "number" && p.bannedUntil <= now);
      if (b === "account_too_new") return !(p.playableAt !== null && p.playableAt <= now);
      return true;
    });
    return live[0] ?? "ok";
  }
  ```
  Тесты:
  - бан истёк, но игрок не в гильдии → `not_guild_member` (раньше было `ok`);
  - истёк бан без других причин → `ok`;
  - постоянный бан → `banned`.

  Фикстуры: `access: "ok"` → `blocks: [], banReason: null`; `access: "X"` → `blocks: ["X"]`.

- [ ] **Step 2: `gameStore`.**
  - Поля `admin: boolean` (из `hello.admin`) и `setConfig(config)`.
  - `applyHello` ставит `admin`.
  - Тест: `setConfig` заменяет конфиг, игрок не меняется.

- [ ] **Step 3: Живой конфиг на холсте.** В `CanvasController` добавь `onConfig(config)`: палитра и размер холста, без сброса чанков. `onHello` вызывает его же. В `session.ts`:
  ```ts
  else if (message.type === "config") {
    store.setConfig(message.config);
    this.canvas = message.config.canvas;
    this.controller?.onConfig(message.config);
    this.applyCamera(true);
  }
  ```
  Тест в `controller.test.ts`: `onConfig` с другой палитрой и размером вызывает `renderer.setPalette` и `setCanvasSize` и не вызывает `dropAll`.

- [ ] **Step 4: `AccessBanner`.** Компонент показывается в `topCenter` под `FreezeBanner`, если `player` есть и `effectiveAccess !== "ok"`. Время берётся из `useServerNow(1000)`. Тексты:
  - `banned`: «Вы заблокированы до {дата время ru-RU}» или «навсегда»; если есть причина — «. Причина: {banReason}». Дальше « — можно только смотреть».
  - `not_guild_member`: «Играть могут только участники сообщества — можно только смотреть».
  - `account_too_new`: «Аккаунт Discord слишком новый — играть можно с {дата}».

  Оформление: `role="status"`, стиль как у `FreezeBanner` (неоновая рамка, `--neon-pink`).

- [ ] **Step 5:** `bun test apps/web && bun run typecheck` → PASS. Commit: `feat(web): every access block, ban banner with reason, live config updates`.

---

### Task 10: Клиент — ссылки в админку и «Выйти» не под панелью

**Files:** Modify `apps/web/src/ui/AuthPanel.tsx`, `AuthPanel.module.css`, `apps/web/src/ui/ProfileTab.tsx`, `apps/web/src/App.tsx`, `App.module.css`

- [ ] **Step 1:** В `AuthPanel` при `admin` перед «Выйти» поставь ссылку `<a className={styles.button} href="/admin">Админка</a>`.

- [ ] **Step 2:** В `ProfileTab` при `admin && !own` добавь под именем ссылку `<a href={\`/admin?tab=players&player=${p.user.id}\`}>Модерировать</a>`.

- [ ] **Step 3: Панель.** Корневой `div` в `App` получает `data-panel={panel === null ? undefined : "open"}` (`useUi((s) => s.panel)`; для анонима, у которого панель не открыта по правилам `SidePanel`, правило безвредно). В `App.module.css`:
  ```css
  /* Desktop: the side panel takes the right edge; keep login, menu and minimap visible to its left. */
  @media (min-width: 901px) {
    .app[data-panel="open"] .top {
      right: calc(min(380px, 100vw) + 12px + env(safe-area-inset-right));
    }
  }
  ```
  Ширину панели вынеси в переменную `--side-panel-width: 380px` в `theme.css` и используй её в обоих местах.

- [ ] **Step 4:** `bun run typecheck && bun run build:web` → PASS. Commit: `feat(web): admin links; keep the top-right controls clear of the side panel`.

---

### Task 11: Каркас `/admin`

**Files:** Modify `apps/web/src/main.tsx`; Create `apps/web/src/admin/AdminApp.tsx`, `admin.module.css`, `labels.ts`

- [ ] **Step 1: Маршрут.** В `main.tsx`:
  ```tsx
  const AdminApp = lazy(() => import("./admin/AdminApp"));
  const isAdminPage = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
  // …внутри провайдеров:
  {isAdminPage ? (
    <Suspense fallback={null}>
      <AdminApp />
    </Suspense>
  ) : (
    <App />
  )}
  ```
  Vite в dev отдаёт `index.html` на `/admin` (SPA fallback). Для production это нужно учесть в Плане 6 (Caddy `try_files`). Добавь пункт в roadmap в Task 15.

- [ ] **Step 2: `AdminApp`** (`export default`).
  - Запрос `trpc.admin.whoami`:
    - пока грузится — «Загрузка…»;
    - если `admin: false` — «Нет доступа» и ссылка «← К холсту» (`/`). Если пользователь не вошёл, добавь подсказку войти на главной.
  - Шапка: «Rave Battle · админка», ссылка «← К холсту», вкладки «Игроки» / «Конфиг» / «Журнал» (кнопки с `aria-pressed`).
  - Вкладка хранится в `?tab=players|config|log` через `history.replaceState`; по умолчанию `players`.
  - Хелпер `useSearchParam(name)` живёт в том же файле: читает `URLSearchParams` и пишет через `replaceState` + `useState`.
  - Тело: `<PlayersSection/>`, `<ConfigSection/>` или `<ModLogSection/>`. В этой задаче вместо секций — заглушки-компоненты с заголовком; Task 12–14 их заменят.

- [ ] **Step 3: `labels.ts`.** Русские подписи:
  - действия: `ban` «Бан», `unban` «Разбан», `player_edit` «Правка игрока», `config_save` «Конфиг», `config_rollback` «Откат конфига»;
  - предметы: `coins` «Монеты», `bomb` «Бомбы», `detector` «Детектор», `defuser` «Дефьюзер»;
  - `adminErrorText(code)`: `self` «Нельзя заблокировать себя», `target_is_admin` «Нельзя заблокировать администратора», `bad_until` «Дата окончания уже прошла», `not_banned` «Игрок не заблокирован», `not_found` «Не найдено», `nothing_to_change` «Нечего менять», `negative_balance` «Баланс ушёл бы ниже нуля», `stale` «Конфиг уже изменили — загрузите свежую версию», `invalid` «Конфиг не прошёл проверку». По умолчанию — «Действие не удалось».

- [ ] **Step 4: Стили `admin.module.css`.**
  - Страница со скроллом: `body` в игре `position: fixed`, здесь корень — обычный поток, `min-height: 100dvh`, `overflow: auto`.
  - Тёмная тема на переменных из `theme.css`; ширина до 1100px по центру; на телефоне поля 16px, без горизонтального скролла.
  - Таблицы со `overflow-x: auto` внутри обёртки.

- [ ] **Step 5:** `bun run typecheck && bun run build:web` → PASS. Проверь, что `index-*.js` (главный чанк) не содержит zod:
  ```bash
  grep -l "ZodError\|_zod" apps/web/dist/assets/*.js
  ```
  Должен найтись только `AdminApp-*.js` или его зависимости, но не `index-*.js`. Commit: `feat(web): lazy /admin shell with access check and tabs`.

---

### Task 12: «Игроки» — поиск, карточка, бан, правка

**Files:** Create `apps/web/src/admin/PlayersSection.tsx`, `PlayerCard.tsx`, `ban.ts`, `ban.test.ts`

- [ ] **Step 1: `ban.ts` (чистая логика) и тест.**
  ```ts
  export const BAN_PRESETS = [
    { key: "1h", label: "1 час", ms: 3_600_000 },
    { key: "24h", label: "24 часа", ms: 86_400_000 },
    { key: "7d", label: "7 дней", ms: 7 * 86_400_000 },
    { key: "30d", label: "30 дней", ms: 30 * 86_400_000 },
    { key: "forever", label: "Навсегда", ms: null },
  ] as const;

  /** `custom` is a datetime-local value in the admin's time zone. */
  export function banUntil(choice: { preset: (typeof BAN_PRESETS)[number]["key"] } | { custom: string }, now: number): number | "permanent" | null
  ```
  - Пресет `forever` возвращает `"permanent"`, остальные пресеты — `now + ms`.
  - Для `custom` разбирается `new Date(value).getTime()`; если это не число или время в прошлом, возвращается `null`.
  - Тесты: каждый пресет; своя дата в будущем и в прошлом; пустая строка.

  Плюс `parseDelta(text: string): number | null`: принимает `"+500"`, `"-2"`, `"0"` и пустую строку (= 0); отклоняет `"1.5"`, `"abc"` и значения больше 1 000 000 по модулю. Тест на каждый случай.

- [ ] **Step 2: `PlayersSection`.**
  - Поле поиска с debounce 300 мс и `trpc.admin.players.search` (`enabled: q.trim().length > 0`). Список результатов — кнопки «имя · #id · discordId · [заблокирован]».
  - Выбранный игрок хранится в `?player=`. Если параметр задан при загрузке (из игрового профиля), карточка открывается сразу.

- [ ] **Step 3: `PlayerCard`** (`trpc.admin.players.get`).
  - **Шапка:** имя, `#id`, Discord ID, дата регистрации, дата Discord-аккаунта, последний вход, гильдия да/нет. Статус «заблокирован до … (причина)» или «активен».
  - **Состояние** (если `state`): монеты, бомбы, детектор, дефьюзер, заряды/лимит, заморожен до, активных бомб, территория, «∞» для `unlimited`. Если `state` нет — «Ещё не заходил в игру — правка недоступна».
  - **Форма бана.** Если не забанен: радиокнопки пресетов, «Своя дата» с `datetime-local`, «Причина» (обязательна, до 200 символов), кнопка «Заблокировать». Если забанен: «Причина разбана» и кнопка «Разблокировать».
  - **Форма правки.** Четыре поля дельты (Монеты / Бомбы / Детектор / Дефьюзер) с подсказкой «+N или −N», «Комментарий» (обязателен) и кнопка «Применить». Отправляются только ненулевые дельты; если все нулевые, кнопка неактивна.
  - **«История модерации игрока»** — список `log`.
  - Мутации идут через `useMutation(trpc.admin.players.ban.mutationOptions())` и т. п. По `onSuccess`:
    - если `ok`, тост в карточке «Готово», `invalidateQueries` для `players.get`, `players.search` и `modLog`, формы очищаются;
    - иначе текст `adminErrorText(code)` под формой.
  - Сетевые ошибки и `FORBIDDEN` показывают «Не удалось выполнить действие». Кнопки на время запроса неактивны.

- [ ] **Step 4:** `bun test apps/web && bun run typecheck` → PASS. Commit: `feat(web): admin player search, ban and balance edits`.

---

### Task 13: «Конфиг» — секции, палитра, проверка, diff, сохранение, история, откат

**Files:** Create `apps/web/src/admin/config-draft.ts`, `config-draft.test.ts`, `ConfigSection.tsx`, `PaletteTable.tsx`, `ConfigHistory.tsx`

- [ ] **Step 1: `config-draft.ts` (чистая логика) и тесты.**
  ```ts
  import { gameConfigSchema, type GameConfig, type PaletteEntry } from "@rave/shared";

  export const SECTIONS = ["canvas", "charges", "coinsPerPixel", "explosion", "bombs", "antiFarm", "defuse", "shop", "starting", "daily", "access"] as const;
  export type Section = (typeof SECTIONS)[number] | "palette";

  export interface Draft {
    /** Pretty JSON per non-palette section, as the admin typed it. */
    texts: Record<(typeof SECTIONS)[number], string>;
    palette: PaletteEntry[];
  }

  export function draftFrom(config: GameConfig): Draft;
  /** Parses every section and runs the shared schema; issues are grouped by section (path[0]). */
  export function checkDraft(draft: Draft): { config: GameConfig | null; issues: Partial<Record<Section, string[]>> };
  /** Changed leaves "path: before → after"; palette entries are matched by id ("palette#33.price"). */
  export function configDiff(before: GameConfig, after: GameConfig): Array<{ path: string; before: string; after: string }>;
  ```
  - `checkDraft` при синтаксической ошибке JSON в секции выдаёт ошибку `["Ошибка JSON: …"]` в этой секции и `config: null`, без запуска схемы.
  - Пути zod `["palette", 3, "price"]` превращаются в `"palette[3].price: message"` в группе `palette`, а `["shop","bomb","price"]` — в `"bomb.price: message"` в группе `shop`.
  - `configDiff` обходит оба объекта рекурсивно. Значения выводятся через `JSON.stringify`; отсутствующее значение — `"—"`. Палитра сравнивается по `id`: добавленный цвет даёт строку `palette#40` с `before: "—"`, удалённый — с `after: "—"`.

  Тесты:
  - `draftFrom(defaultConfig)` → `checkDraft` даёт `config`, равный `defaultConfig`, и пустые `issues`;
  - битый JSON в `shop` даёт ошибку только в `shop`;
  - `charges.max = 0` даёт ошибку в `charges`;
  - дубликат id в палитре даёт ошибку в `palette`;
  - diff: смена цены бомбы → `[{ path: "shop.bomb.price", before: "…", after: "…" }]`;
  - diff: добавление и удаление цвета, смена `base` у `palette#33`;
  - diff одинаковых конфигов пуст.

- [ ] **Step 2: `PaletteTable`.**
  - Строки: id (число), образец цвета, `base` (`<input type="color">` + текстовое поле), `type` (select), `unlock` (select), `price` (число, активно только при `shop`), `params` (JSON одной строкой; при ошибке разбора строка подсвечена, а в черновик идёт предыдущий валидный `params`), кнопка «✕» удалить.
  - Кнопка «Добавить цвет» берёт первый свободный id ≥ 32, ставит `type: "solid"`, `unlock: "shop"`, `price: 300`, `base: "#ffffff"`, `params: {}`.
  - Таблица контролируемая: `value` + `onChange(palette)`.

- [ ] **Step 3: `ConfigSection`.**
  - Запрос `trpc.admin.config.current` даёт `{version, config}`. Черновик создаётся `draftFrom` при первой загрузке и не перетирается при refetch, пока админ не нажмёт «Загрузить текущую версию».
  - Над формой: «Версия N». Если черновик отличается от текущей версии, рядом «есть несохранённые изменения».
  - Для каждой секции из `SECTIONS`: заголовок с ключом, `<textarea>` (моноширинный шрифт, авто-высота по строкам) и список ошибок секции под ним. Палитра — `PaletteTable` со своими ошибками.
  - `checkDraft` пересчитывается в `useMemo` на каждое изменение.
  - Снизу панель сохранения:
    1. Кнопка «Проверить и сохранить…» неактивна при ошибках или пустом diff.
    2. По нажатию раскрывается блок: список `configDiff(current, draft)`, поле «Комментарий» (обязательно) и «Сохранить как версию N+1».
    3. Отправка: `admin.config.save({ baseVersion: N, config, comment })`.
  - Ответы на сохранение:
    - `ok`: «Сохранено: версия M», refetch `current` и `history`, черновик пересоздаётся из нового конфига.
    - `stale`: «Конфиг уже изменили (версия X). Ваш черновик сохранён» и кнопка «Загрузить текущую версию» (с `confirm()`, потому что черновик пропадёт).
    - `invalid`: ошибки разложены по секциям так же (путь вида `canvas.width` → секция `canvas`; `palette` → палитра).

- [ ] **Step 4: `ConfigHistory`** (под редактором).
  - Таблица последних 50 версий: версия, дата, автор, комментарий. У текущей версии пометка «текущая».
  - Кнопка «Показать» загружает `admin.config.get({version})` и показывает `configDiff(текущая, выбранная)`: что изменится при откате.
  - Кнопка «Откатить к этой» (не у текущей) открывает поле «Комментарий» и подтверждение, затем `admin.config.rollback({ version, baseVersion: current, comment })`. Ответы обрабатываются как при сохранении.

- [ ] **Step 5:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS. Commit: `feat(web): admin config editor with per-section validation, diff, history and rollback`.

---

### Task 14: «Журнал»

**Files:** Create `apps/web/src/admin/ModLogSection.tsx`

- [ ] **Step 1:** Фильтры: select «Действие» (все + 5 действий) и «Игрок» (числовой id; заполняется кнопкой «только этот игрок» из строки). Запрос — `useInfiniteQuery(trpc.admin.modLog.infiniteQueryOptions({ action, targetUserId }, { getNextPageParam: (last) => last.next ?? undefined }))`. Вход процедуры — `cursor` (см. Task 7).

- [ ] **Step 2:** Таблица: дата, админ, действие, цель (кнопка-имя → `?tab=players&player=id`), детали. Детали — компактная строка по `params`:
  - `ban`: «до {дата|навсегда}: {reason}»;
  - `unban`: «{reason}»;
  - `player_edit`: «Монеты +500, Бомбы −1 — {comment}»;
  - `config_save`: «версия N — {comment}»;
  - `config_rollback`: «версия N (из M) — {comment}».

  Кнопка «Показать ещё» видна при `hasNextPage`.

- [ ] **Step 3:** `bun run typecheck && bun run build:web` → PASS. Commit: `feat(web): admin moderation log with filters and paging`.

---

### Task 15: Проверка целиком и roadmap

- [ ] **Step 1:** Из корня: `bun test`, `bun run typecheck`, `bun run build:web` → всё PASS. Запиши число тестов.

- [ ] **Step 2: Ручная проверка в браузере** (dev-сервер и Vite; два окна: `admin` и обычный dev-игрок `alice`):
  1. **Доступ.** У alice нет ссылки «Админка», а `/admin` показывает «Нет доступа». У admin ссылка есть, страница открывается.
  2. **Бан.**
     - Поиск `ali` → карточка alice. Бан на 1 час с причиной.
     - У alice без перезагрузки появляется баннер с датой и причиной, пиксель не ставится, магазин заблокирован.
     - В «Рейтингах» alice нет.
     - Разбан → баннер исчезает, alice снова рисует.
  3. **Правка.** «+500 монет, −1 бомба» с комментарием → у alice в HUD сразу +500 и −1 бомба. «−999999 монет» → «Баланс ушёл бы ниже нуля».
  4. **Конфиг.**
     - Цена бомбы +10 → diff показывает одну строку; сохранение с комментарием. В магазине alice цена меняется без перезагрузки.
     - `charges.max` 10 → 5: у alice лимит зарядов 5.
     - Ширина холста 512 → 768: у alice холст расширился, по новой области можно рисовать, миникарта новой формы. После перезапуска сервера всё осталось.
     - Уменьшение ширины → ошибка под секцией `canvas` от сервера. На клиенте это не ловится, так что ответ сервера показывается.
     - Удаление цвета, который есть на холсте → ошибка под палитрой.
     - Устаревшее сохранение: два окна админки, сохранить в первом, затем во втором → «Конфиг уже изменили», черновик на месте.
     - Откат к предыдущей версии из истории → новая версия, цена вернулась.
  5. **Журнал.** Все действия выше присутствуют, фильтр по «Бан» и по alice работают, «Показать ещё» работает при более чем 50 записях. Записи можно нагенерировать правками.
  6. **Профиль.** «Модерировать» в профиле alice ведёт на её карточку.
  7. **Панель.** На десктопе при открытой панели видны «Выйти», меню и миникарта.
  8. **Телефон** (375×812): `/admin` без горизонтального скролла, формы пригодны.
  9. **zod.** В production-сборке главный чанк без zod.

  После проверки верни конфиг dev-БД, если проверка его испортила. Дальнейшие правки — через редактор.

- [ ] **Step 3: roadmap.**
  - Строку «5» таблицы разбей на «5a» и «5b», описав результат 5a.
  - В «Заметках для Плана 5» отметь закрытые пункты: бан, единый источник, кеш, причины доступа, тесты, «Выйти», `config:defaults`.
  - Добавь раздел «Заметки для Плана 5b / 6» из финального ревью 5a, включая Caddy SPA fallback для `/admin`.

  Commit: `docs: update the roadmap after plan 5a`.

---

## Самопроверка плана

- **Покрытие решений.** Каждая строка таблицы решений закрыта задачами:
  - доступ — 1;
  - бан — 2, 7, 9;
  - правка — 3, 7, 12;
  - журнал — 3, 7, 14;
  - конфиг — 4, 5, 7, 13;
  - `config:defaults` — 8;
  - хвосты — 2, 6, 9, 10.
- **Согласованность типов.**
  - `PlayerView.blocks` и `banReason` вводятся в Task 2 (сервер) и Task 9 (клиент); между этими задачами клиентский typecheck временно красный, это оговорено в Task 2.
  - `ModAction`/`MOD_ACTIONS` вводятся в Task 3, используются в 7 и 14.
  - `ConfigResult` и `ConfigIssue` — Task 4 → 7 → 13.
  - Курсор журнала: сервис принимает `before`, вход процедуры — `cursor` (Task 7 и Task 14).
- **Атомарность.**
  - Конфиг и правки игрока пишутся событиями движка в одной транзакции group commit.
  - Бан пишется DB-транзакцией (`users` + `mod_log`), затем применяется в движке. При падении между шагами бан в БД есть, а движок подхватит его при рестарте (`loadPlayers`). Расхождение до рестарта возможно только при сбое `runtime.run`, а это fail-fast с выходом процесса.
- **Безопасность.**
  - Все `admin.*` проверяют права на сервере.
  - Мутации идут через POST с проверкой Origin. Админские query — GET с cookie; без CORS-заголовков чужой сайт ответ не прочитает.
  - Координаты бомб в 5a не отдаются (инспектор — 5b).
- **Вне скоупа 5a:** откаты пикселей, очистка области, снятие бомб, инспектор (5b); сезоны в ключах кешей; доверенный `X-Forwarded-For` (План 6); лимит на `/overview`.
