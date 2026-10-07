# План 2c: Discord и tRPC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Настоящий вход через Discord OAuth2 (state, опциональная проверка гильдии), tRPC-API для всех действий игрока кроме пикселей (магазин, дейлик, детектор, дефьюзер, `me`), закрытие сокетов при выходе, обновление доступа существующих игроков, чистка просроченных сессий.

**Architecture:** Discord-клиент — чистые функции с внедряемым `fetch` (тесты без сети). OAuth-маршруты в `auth/discord-routes.ts`. tRPC монтируется в `route()` по префиксу `/trpc/`; все мутации идут через `runtime.run`, поэтому обновления игрока и лента рассылаются существующим `handleCommit` без нового кода рассылки. Членство в гильдии хранится в `users.guild_member` и попадает в движок при создании игрока и через новую команду `setAccess`.

**Tech Stack:** Bun 1.3, TypeScript 7, `@trpc/server@11.19.0` (fetch adapter), zod 4, drizzle + postgres.js.

**Спека:** `docs/superpowers/specs/2026-10-07-rave-battle-design.md` (2.2, 2.5–2.7, 3.5, 3.6, 8). **Роадмап:** `docs/superpowers/plans/2026-10-07-00-roadmap.md` («Заметки для Плана 2c»).

**Проверено (2026-10-08):**
- Discord (официальная документация): authorize `https://discord.com/oauth2/authorize` (`client_id`, `response_type=code`, `redirect_uri`, `scope` через пробел, `state`); token `POST https://discord.com/api/oauth2/token`, `application/x-www-form-urlencoded`, `client_id`+`client_secret` в теле разрешены; `GET https://discord.com/api/v10/users/@me` (`id`, `username`, `global_name`, `avatar`); `GET /users/@me/guilds` (скоуп `guilds`, `limit` до 200 = максимум гильдий пользователя); snowflake: `(id >> 22) + 1420070400000`.
- tRPC 11.19.0 (проба в scratchpad): `initTRPC.context<C>().create({ isDev })`, middleware через `.use(({ctx, next}) => next({ctx}))`, `t.createCallerFactory(router)(ctx)`, `fetchRequestHandler({ endpoint, req, router, createContext })`; ответ `{"result":{"data":...}}`; POST без `content-type` → 415; при `isDev: false` stack trace в ошибках не отдаётся.

**Решения этого плана:**
- Пользователь не из гильдии **входит**, но играет только как зритель (движок отвечает `not_guild_member`). Членство проверяется на каждом входе и сохраняется в `users.guild_member` (миграция `0001`).
- Discord-токен не хранится: после входа он не нужен (refresh не используем).
- Отображаемое имя: `global_name ?? username`, обновляется на каждом входе (`users.set`).
- `state`: 16 случайных байт в cookie `rb_oauth_state` (`Path=/auth/discord`, `HttpOnly`, `SameSite=Lax`, `Max-Age=600`, `Secure` на https). Несовпадение → 400. Ошибка Discord → редирект на `/?login_error=discord`.
- В production Discord обязателен (`DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET`); `DISCORD_GUILD_ID` опционален. Пустые значения в `.env` считаются отсутствующими.
- tRPC: результаты игровых команд **возвращаются** (`{ ok: false, code }`), а не бросаются — клиенту удобно показывать причину. Бросаются только `UNAUTHORIZED`, `TOO_MANY_REQUESTS`, `BAD_REQUEST` (zod).
- tRPC-мутации (не-GET) требуют разрешённый `Origin` (как WebSocket); GET-запросы только читают.
- Rate limit tRPC: на пользователя 20 запросов, +5/с.
- Выход (`/auth/logout`) закрывает сокеты **этой сессии** кодом `4001`; другие сессии пользователя не трогаются. Бан/кик в реальном времени — План 5 (есть `setAccess` и топик `user:<id>`).
- Просроченные сессии удаляются при старте и раз в час.
- Исправлено по ревью Task 1–3: Discord id — `^[1-9]\d{0,19}$` и меньше 2^64; имя 1–32 символа (`global_name || username`); таймаут запросов к Discord 10 с.
- Исправлено по ревью Task 4–5: `addPlayer` **не** меняет доступ существующего игрока (синхронизация из сессии откачена: данные сессии читаются на upgrade и могут быть старее бана/разбана, сделанного между upgrade и `open`). Пока сервер работает, авторитетен движок; каждый, кто меняет доступ (вход, модерация в Плане 5), обновляет **и** `users`, **и** движок через `setAccess`. Cookie `state` на https — `__Host-rb_oauth_state` с `Path=/`. Ответ Discord с `?error=` при валидном state → редирект на `/?login_error=denied`. `POST /auth/logout` требует разрешённый `Origin`.
- Координаты в tRPC-входах валидируются как неотрицательные целые; границы холста проверяет движок.

---

## Файловая структура

```
apps/server/
├── drizzle/0001_guild_member.sql            (generated) users.guild_member
└── src/
    ├── db/schema.ts                         + users.guildMember
    ├── auth/
    │   ├── users.ts                         upsertUser(... guildMember)
    │   ├── session.ts                       SessionUser.guildMember/sessionId, readCookie, sessionIdOf, deleteExpiredSessions
    │   ├── discord.ts                       Discord API: authorizeUrl, exchangeCode, fetchProfile, isGuildMember, snowflakeCreatedAt
    │   ├── discord.test.ts
    │   └── discord-routes.ts                /auth/discord, /auth/discord/callback
    ├── engine/
    │   ├── engine.ts                        + setAccess
    │   └── engine.access.test.ts
    ├── persistence/load-game.ts             guildMember из users
    ├── net/
    │   ├── deps.ts                          AppDeps (вынесен из server.ts)
    │   ├── env.ts                           + Discord-конфиг
    │   ├── rate-limit.ts                    + UserRateLimiter
    │   ├── hub.ts                           guildMember из сессии, disconnectSession
    │   └── server.ts                        маршруты Discord и /trpc
    ├── trpc/
    │   ├── init.ts                          контекст, процедуры, middleware
    │   ├── router.ts                        appRouter
    │   └── router.test.ts
    └── main.ts                              Discord-конфиг, чистка сессий
```

---

### Task 1: Членство в гильдии в `users`

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/auth/users.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/persistence/load-game.ts`, `apps/server/src/net/hub.ts`
- Create (generated): `apps/server/drizzle/0001_guild_member.sql` + meta
- Test: `apps/server/src/auth/session.test.ts`, `apps/server/src/persistence/load-game.test.ts`, `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тесты**

В `apps/server/src/auth/session.test.ts` тест `"a fresh session resolves to its user"` — ожидание заменить на:
```ts
    expect(await resolveSession(t.db, token, T0)).toEqual({
      id,
      username: "alice",
      discordCreatedAt: Date.UTC(2015, 0, 1),
      bannedUntil: null,
      guildMember: true,
      sessionId: expect.any(String),
    });
```
и в `describe("upsertUser")` добавить:
```ts
  test("stores guild membership and refreshes it on the next login", async () => {
    const profile = { discordId: "123", username: "bob", avatar: null, discordCreatedAt: new Date(Date.UTC(2016, 0, 1)) };
    const id = await upsertUser(t.db, { ...profile, guildMember: false });
    const { token } = await createSession(t.db, id, DAY, T0);
    expect((await resolveSession(t.db, token, T0))?.guildMember).toBe(false);
    await upsertUser(t.db, { ...profile, guildMember: true });
    expect((await resolveSession(t.db, token, T0))?.guildMember).toBe(true);
  });
```

В `apps/server/src/persistence/load-game.test.ts` внутри `describe("loadGame")`:
```ts
  test("guild membership is loaded from users", async () => {
    const a = await insertUser(t.db, "a");
    const { seasonId } = await loadGame(t.db, T0);
    const { addPlayer } = makeEngine();
    const pa = addPlayer(a);
    await t.db.transaction((tx) =>
      writeBatch(tx, { seasonId, events: [], players: [], newPlayers: [{ player: snapshotPlayer(pa), at: T0 }], chunks: [] }),
    );
    await t.db.update(users).set({ guildMember: false }).where(sql`${users.id} = ${a}`);
    expect((await loadGame(t.db, T0)).engine.players.get(a).guildMember).toBe(false);
  });
```

В `apps/server/src/net/server.test.ts` внутри `describe("websocket")`:
```ts
  test("users outside the guild can watch but not place", async () => {
    const cookie = await login("outsider");
    await t.db.update(usersTable).set({ guildMember: false }).where(eq(usersTable.username, "outsider"));
    const c = await connect(cookie);
    c.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(c, 1)).result).toEqual({ ok: false, code: "not_guild_member" });
  });
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `bun test apps/server/src/auth/session.test.ts apps/server/src/persistence/load-game.test.ts apps/server/src/net/server.test.ts`
Expected: FAIL — нет поля/колонки `guildMember`, нет `sessionId`; typecheck тоже упадёт — это ожидаемо.

- [ ] **Step 3: Схема и миграция**

В `users` (`apps/server/src/db/schema.ts`) после `banReason`:
```ts
  /** Refreshed on every Discord login; dev users are always members. */
  guildMember: boolean("guild_member").notNull().default(true),
```
(добавить `boolean` в импорт из `drizzle-orm/pg-core`).

Run:
```bash
cd apps/server && bunx drizzle-kit generate --name guild_member && cd ../..
grep -n "guild_member" apps/server/drizzle/0001_guild_member.sql
```
Expected: `ALTER TABLE "users" ADD COLUMN "guild_member" boolean DEFAULT true NOT NULL;`

- [ ] **Step 4: `upsertUser`**

`apps/server/src/auth/users.ts`:
```ts
import type { Db } from "../db/client";
import { users } from "../db/schema";

export interface UserProfile {
  discordId: string;
  username: string;
  avatar: string | null;
  discordCreatedAt: Date;
  /** Defaults to true (no guild configured, dev users). */
  guildMember?: boolean;
}

/** Creates or refreshes a user by Discord id; returns the internal id. */
export async function upsertUser(db: Db, profile: UserProfile): Promise<number> {
  const guildMember = profile.guildMember ?? true;
  const [row] = await db
    .insert(users)
    .values({ ...profile, guildMember })
    .onConflictDoUpdate({
      target: users.discordId,
      set: { username: profile.username, avatar: profile.avatar, guildMember, lastSeenAt: new Date() },
    })
    .returning({ id: users.id });
  return row!.id;
}
```

- [ ] **Step 5: Сессия**

В `apps/server/src/auth/session.ts`:

1. `SessionUser` дополнить:
```ts
  guildMember: boolean;
  /** Hash of the session token; identifies the session without exposing the token. */
  sessionId: string;
```
2. Экспортировать хэш: заменить `const hashToken = ...` на
```ts
/** Sessions are stored and identified by the SHA-256 of their token. */
export const sessionIdOf = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
```
и все вызовы `hashToken(token)` заменить на `sessionIdOf(token)`.
3. В `resolveSession` выбрать `guildMember: users.guildMember` и вернуть:
```ts
  return {
    id: row.id,
    username: row.username,
    discordCreatedAt: row.discordCreatedAt.getTime(),
    bannedUntil: banFromDate(row.bannedUntil),
    guildMember: row.guildMember,
    sessionId: sessionIdOf(token),
  };
```

- [ ] **Step 6: Загрузка и хаб**

`apps/server/src/persistence/load-game.ts`, `loadPlayers`: в `select` добавить `guildMember: users.guildMember`, в деструктуризацию — `guildMember`, и заменить строки
```ts
      // Re-checked at login (Plan 2b); offline players cannot act anyway.
      guildMember: true,
```
на
```ts
      guildMember,
```

`apps/server/src/net/hub.ts`, `open`: заменить комментарий и `guildMember: true` на `guildMember: user.guildMember,`.

- [ ] **Step 7: Запустить, убедиться что проходит**

Run: `bun test && bun run typecheck`
Expected: 0 fail, **161** pass (158 + 3); typecheck exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(auth): persist guild membership per user"
```

---

### Task 2: Команда движка `setAccess`

**Files:**
- Modify: `apps/server/src/engine/engine.ts`
- Test: `apps/server/src/engine/engine.access.test.ts`

- [ ] **Step 1: Тест**

`apps/server/src/engine/engine.access.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { makeEngine, T0 } from "./test-utils";

const place = { x: 1, y: 1, colorId: 3, withBomb: false };

describe("setAccess", () => {
  test("updates guild membership and bans of an existing player", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.setAccess(1, { guildMember: false });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: false, code: "not_guild_member" });
    engine.setAccess(1, { guildMember: true, bannedUntil: Number.POSITIVE_INFINITY });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: false, code: "banned" });
    engine.setAccess(1, { bannedUntil: null });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("omitted fields stay unchanged and no events are emitted", () => {
    const { engine, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.bannedUntil = T0 + 1;
    engine.setAccess(1, { guildMember: false });
    expect(p.bannedUntil).toBe(T0 + 1);
    expect(engine.drainEvents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/engine/engine.access.test.ts`
Expected: FAIL — `engine.setAccess is not a function`.

- [ ] **Step 3: Реализовать**

В класс `GameEngine` после `claimDaily`:
```ts
  /** Login and moderation update access flags. They live in `users`, so no events are emitted. */
  setAccess(userId: UserId, access: { guildMember?: boolean; bannedUntil?: number | null }): void {
    const p = this.players.get(userId);
    if (access.guildMember !== undefined) p.guildMember = access.guildMember;
    if (access.bannedUntil !== undefined) p.bannedUntil = access.bannedUntil;
  }
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/engine/engine.access.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): add access updates for existing players"
```

---

### Task 3: Discord API-клиент

**Files:**
- Create: `apps/server/src/auth/discord.ts`
- Test: `apps/server/src/auth/discord.test.ts`

- [ ] **Step 1: Тесты**

`apps/server/src/auth/discord.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
  authorizeUrl,
  DiscordError,
  exchangeCode,
  fetchProfile,
  isGuildMember,
  snowflakeCreatedAt,
  type DiscordConfig,
  type FetchFn,
} from "./discord";

const cfg: DiscordConfig = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:5173/auth/discord/callback", guildId: "42" };

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("discord", () => {
  test("snowflake timestamps use the Discord epoch", () => {
    expect(snowflakeCreatedAt("175928847299117063").toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });

  test("authorize URL carries client, redirect, scopes and state", () => {
    const url = new URL(authorizeUrl(cfg, "st4te"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      response_type: "code",
      redirect_uri: cfg.redirectUri,
      scope: "identify guilds",
      state: "st4te",
    });
    expect(authorizeUrl(cfg, "s")).toContain("scope=identify%20guilds");
    expect(new URL(authorizeUrl({ ...cfg, guildId: null }, "s")).searchParams.get("scope")).toBe("identify");
  });

  test("exchanges the code with a form-encoded POST", async () => {
    const { fn, calls } = fakeFetch(() => json({ access_token: "tok", token_type: "Bearer" }));
    expect(await exchangeCode(fn, cfg, "the-code")).toBe("tok");
    expect(calls[0]?.url).toBe("https://discord.com/api/oauth2/token");
    expect(calls[0]?.init?.method).toBe("POST");
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: "cid",
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: cfg.redirectUri,
    });
  });

  test("HTTP errors, network errors and unexpected shapes become DiscordError", async () => {
    await expect(exchangeCode(fakeFetch(() => json({ error: "invalid_grant" }, 400)).fn, cfg, "c")).rejects.toBeInstanceOf(DiscordError);
    const offline: FetchFn = async () => {
      throw new TypeError("network down");
    };
    await expect(exchangeCode(offline, cfg, "c")).rejects.toBeInstanceOf(DiscordError);
    await expect(fetchProfile(fakeFetch(() => json({ nope: 1 })).fn, "tok")).rejects.toBeInstanceOf(DiscordError);
  });

  test("profile prefers the global display name and derives the account age", async () => {
    const { fn, calls } = fakeFetch(() => json({ id: "175928847299117063", username: "neko", global_name: "Neko Raver", avatar: "abc" }));
    expect(await fetchProfile(fn, "tok")).toEqual({
      id: "175928847299117063",
      username: "Neko Raver",
      avatar: "abc",
      createdAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/users/@me");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    const plain = fakeFetch(() => json({ id: "1", username: "neko", global_name: null, avatar: null }));
    expect((await fetchProfile(plain.fn, "tok")).username).toBe("neko");
  });

  test("guild membership is read from the user's guild list", async () => {
    const { fn, calls } = fakeFetch(() => json([{ id: "7" }, { id: "42" }]));
    expect(await isGuildMember(fn, "tok", "42")).toBe(true);
    expect(await isGuildMember(fn, "tok", "99")).toBe(false);
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/users/@me/guilds?limit=200");
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `bun test apps/server/src/auth/discord.test.ts`
Expected: FAIL — `Cannot find module './discord'`.

- [ ] **Step 3: Реализовать**

`apps/server/src/auth/discord.ts`:
```ts
import { z } from "zod";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1_420_070_400_000n;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** When set, players must be members of this guild. */
  guildId: string | null;
}

export interface DiscordProfile {
  id: string;
  /** Display name: `global_name` when set, otherwise `username`. */
  username: string;
  avatar: string | null;
  createdAt: Date;
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.string().regex(/^\d+$/),
  username: z.string(),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
});
const guildsSchema = z.array(z.object({ id: z.string() }));

export function snowflakeCreatedAt(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export function authorizeUrl(cfg: DiscordConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: cfg.guildId ? "identify guilds" : "identify",
    state,
  });
  // Discord documents scopes as %20-separated.
  return `${DISCORD_AUTHORIZE_URL}?${params.toString().replaceAll("+", "%20")}`;
}

async function request<T>(fetchFn: FetchFn, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (error) {
    throw new DiscordError(`Discord request failed: ${String(error)}`, 0);
  }
  if (!res.ok) throw new DiscordError(`Discord responded ${res.status}`, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DiscordError("Discord returned invalid JSON", res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DiscordError("Unexpected Discord response", res.status);
  return parsed.data;
}

export async function exchangeCode(fetchFn: FetchFn, cfg: DiscordConfig, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  const token = await request(
    fetchFn,
    DISCORD_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
    tokenSchema,
  );
  return token.access_token;
}

export async function fetchProfile(fetchFn: FetchFn, accessToken: string): Promise<DiscordProfile> {
  const user = await request(fetchFn, `${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } }, userSchema);
  return {
    id: user.id,
    username: user.global_name ?? user.username,
    avatar: user.avatar ?? null,
    createdAt: snowflakeCreatedAt(user.id),
  };
}

/** A user can be in at most 200 guilds, so one page is the whole list. */
export async function isGuildMember(fetchFn: FetchFn, accessToken: string, guildId: string): Promise<boolean> {
  const guilds = await request(
    fetchFn,
    `${DISCORD_API}/users/@me/guilds?limit=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    guildsSchema,
  );
  return guilds.some((g) => g.id === guildId);
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/auth/discord.test.ts && bun run typecheck`
Expected: PASS, 6 tests; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth
git commit -m "feat(auth): add discord oauth api client"
```

---

### Task 4: Discord-конфиг и маршруты входа

**Files:**
- Create: `apps/server/src/net/deps.ts`, `apps/server/src/auth/discord-routes.ts`
- Modify: `apps/server/src/net/env.ts`, `apps/server/src/net/server.ts`, `apps/server/src/auth/session.ts`
- Test: `apps/server/src/net/env.test.ts`, `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тесты окружения**

В `apps/server/src/net/env.test.ts` дописать:
```ts
test("discord is configured from client id and secret", () => {
  const cfg = loadEnv({ ...base, DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "sec", DISCORD_GUILD_ID: "42" });
  expect(cfg.discord).toEqual({ clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost:5173/auth/discord/callback", guildId: "42" });
  expect(loadEnv({ ...base, DISCORD_CLIENT_ID: "", DISCORD_CLIENT_SECRET: "" }).discord).toBeNull();
});

test("half a discord config is rejected", () => {
  expect(() => loadEnv({ ...base, DISCORD_CLIENT_ID: "cid" })).toThrow();
});

test("production requires discord", () => {
  expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow();
  expect(loadEnv({ ...base, NODE_ENV: "production", DISCORD_CLIENT_ID: "c", DISCORD_CLIENT_SECRET: "s" }).discord?.guildId).toBeNull();
});
```

- [ ] **Step 2: Тесты маршрутов**

В `apps/server/src/net/server.test.ts`:

1. Сигнатуру `start` расширить и передать новые поля:
```ts
async function start(
  options: { devLogin?: boolean; hub?: Partial<HubOptions>; discord?: DiscordConfig | null; fetch?: FetchFn; keepDb?: boolean } = {},
) {
```
первую строку тела `await t.reset();` заменить на `if (!options.keepDb) await t.reset();` (перезапуск без сброса = рестарт сервера на той же БД), в `config` добавить `discord: options.discord ?? null,`, а в вызов `startServer` — `fetch: options.fetch`:
```ts
  server = startServer({ db: t.db, runtime, hub, users, config, fetch: options.fetch });
```
Импорты: `import type { DiscordConfig, FetchFn } from "../auth/discord";`.

2. Добавить в конец файла:
```ts
describe("discord login", () => {
  const discord: DiscordConfig = { clientId: "cid", clientSecret: "sec", redirectUri: `${ORIGIN}/auth/discord/callback`, guildId: "42" };

  /** Fake Discord: `guilds` decides membership, `fail` breaks the token endpoint. */
  function fakeDiscord(options: { guilds?: string[]; fail?: boolean; name?: string } = {}): FetchFn {
    return async (url) => {
      if (url === "https://discord.com/api/oauth2/token") {
        return options.fail ? new Response("{}", { status: 400 }) : Response.json({ access_token: "tok" });
      }
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: "175928847299117063", username: "neko", global_name: options.name ?? "Neko", avatar: null });
      }
      if (url.includes("/users/@me/guilds")) return Response.json((options.guilds ?? ["42"]).map((id) => ({ id })));
      return new Response("unexpected", { status: 500 });
    };
  }

  async function restartWith(fetchFn: FetchFn) {
    await shutdown();
    await start({ discord, fetch: fetchFn });
  }

  /** Runs the redirect dance and returns the session cookie (or the final response when it fails). */
  async function discordLogin(): Promise<{ res: Response; cookie: string | null }> {
    const begin = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    expect(begin.status).toBe(302);
    const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = begin.headers.get("set-cookie")!.split(";")[0]!;
    const res = await fetch(`${base}/auth/discord/callback?code=c0de&state=${state}`, { redirect: "manual", headers: { Cookie: stateCookie } });
    const session = res.headers.getSetCookie().find((c) => c.startsWith("rb_session="));
    return { res, cookie: session ? session.split(";")[0]! : null };
  }

  test("is 404 when discord is not configured", async () => {
    expect((await fetch(`${base}/auth/discord`, { redirect: "manual" })).status).toBe(404);
  });

  test("a guild member logs in and can play under their display name", async () => {
    await restartWith(fakeDiscord({ name: "Neko Raver" }));
    const { res, cookie } = await discordLogin();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const c = await connect(cookie!);
    expect(hello(c).user?.name).toBe("Neko Raver");
    c.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(c, 1)).result).toEqual({ ok: true, outcome: "placed" });
  });

  test("leaving the guild takes effect on the next login for an existing player", async () => {
    await restartWith(fakeDiscord());
    const first = await connect((await discordLogin()).cookie!);
    first.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    await placed(first, 1);

    // Same database: the player is loaded as a member, the new login must revoke it via setAccess.
    await shutdown();
    await start({ discord, fetch: fakeDiscord({ guilds: ["7"] }), keepDb: true });
    const second = await connect((await discordLogin()).cookie!);
    second.ws.send(encodePlace({ reqId: 2, x: 2, y: 2, colorId: 3, withBomb: false }));
    expect((await placed(second, 2)).result).toEqual({ ok: false, code: "not_guild_member" });
  });

  test("a mismatched state is rejected", async () => {
    await restartWith(fakeDiscord());
    await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const res = await fetch(`${base}/auth/discord/callback?code=c&state=forged`, { redirect: "manual", headers: { Cookie: "rb_oauth_state=real" } });
    expect(res.status).toBe(400);
  });

  test("discord failures redirect with an error and create no session", async () => {
    await restartWith(fakeDiscord({ fail: true }));
    const { res, cookie } = await discordLogin();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?login_error=discord");
    expect(cookie).toBeNull();
  });
});
```

- [ ] **Step 3: Запустить, убедиться что падают**

Run: `bun test apps/server/src/net`
Expected: FAIL — нет `discord` в конфиге, маршрутов нет.

- [ ] **Step 4: `AppDeps` в отдельный модуль**

`apps/server/src/net/deps.ts`:
```ts
import type { FetchFn } from "../auth/discord";
import type { Db } from "../db/client";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import type { Hub } from "./hub";
import type { UserRateLimiter } from "./rate-limit";
import type { UserDirectory } from "./user-directory";

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Hub;
  users: UserDirectory;
  config: ServerConfig;
  /** Outbound HTTP (Discord); injectable for tests. Defaults to global fetch. */
  fetch?: FetchFn;
  /** tRPC rate limiter; startServer creates one when omitted. */
  limiter?: UserRateLimiter;
}
```
В `apps/server/src/net/server.ts` удалить локальный `interface AppDeps` и импортировать: `import type { AppDeps } from "./deps";` (импорты `Db`, `GameRuntime`, `ServerConfig`, `Hub`, `UserDirectory`, ставшие лишними, убрать; `SocketData` оставить).

`UserRateLimiter` появится в Task 6 — до него в `deps.ts` строку `limiter?: UserRateLimiter;` и её импорт **не добавлять** (добавить в Task 6).

- [ ] **Step 5: Конфиг**

В `apps/server/src/net/env.ts`:

1. Импорт `import type { DiscordConfig } from "../auth/discord";`.
2. Перед `envSchema`:
```ts
/** `KEY=` in .env means "not set". */
const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
```
3. В объект схемы добавить:
```ts
    DISCORD_CLIENT_ID: optionalString,
    DISCORD_CLIENT_SECRET: optionalString,
    DISCORD_GUILD_ID: z.preprocess((value) => (value === "" ? undefined : value), z.string().regex(/^\d+$/).optional()),
```
и два `refine` после существующих:
```ts
  .refine((env) => (env.DISCORD_CLIENT_ID === undefined) === (env.DISCORD_CLIENT_SECRET === undefined), {
    message: "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set together",
    path: ["DISCORD_CLIENT_ID"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.DISCORD_CLIENT_ID !== undefined, {
    message: "Discord login must be configured in production",
    path: ["DISCORD_CLIENT_ID"],
  })
```
4. В `ServerConfig`:
```ts
  /** null when Discord login is not configured (development). */
  discord: DiscordConfig | null;
```
5. В `loadEnv` в возвращаемый объект:
```ts
    discord:
      env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? {
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
            redirectUri: `${publicUrl.origin}/auth/discord/callback`,
            guildId: env.DISCORD_GUILD_ID ?? null,
          }
        : null,
```

- [ ] **Step 6: Общий разбор cookie**

В `apps/server/src/auth/session.ts` вынести разбор в экспортируемую функцию и использовать её в `readSessionToken`:
```ts
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function readSessionToken(req: Request, secure: boolean): string | null {
  return readCookie(req, sessionCookieName(secure));
}
```

- [ ] **Step 7: Маршруты**

`apps/server/src/auth/discord-routes.ts`:
```ts
import type { AppDeps } from "../net/deps";
import { authorizeUrl, DiscordError, exchangeCode, fetchProfile, isGuildMember, type DiscordProfile } from "./discord";
import { createSession, readCookie, sessionCookie } from "./session";
import { upsertUser } from "./users";

const STATE_COOKIE = "rb_oauth_state";
const STATE_PATH = "/auth/discord";
const STATE_TTL_SECONDS = 600;

function stateCookie(value: string, maxAge: number, secure: boolean): string {
  return [`${STATE_COOKIE}=${value}`, `Path=${STATE_PATH}`, "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}

export function startDiscordLogin(deps: AppDeps): Response {
  const discord = deps.config.discord!;
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(discord, state),
      "Set-Cookie": stateCookie(state, STATE_TTL_SECONDS, deps.config.secureCookies),
    },
  });
}

export async function finishDiscordLogin(req: Request, deps: AppDeps): Promise<Response> {
  const discord = deps.config.discord!;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return new Response("Invalid OAuth state", { status: 400 });

  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", stateCookie("", 0, deps.config.secureCookies));
  const fetchFn = deps.fetch ?? fetch;

  let profile: DiscordProfile;
  let guildMember: boolean;
  try {
    const accessToken = await exchangeCode(fetchFn, discord, code);
    profile = await fetchProfile(fetchFn, accessToken);
    guildMember = discord.guildId ? await isGuildMember(fetchFn, accessToken, discord.guildId) : true;
  } catch (error) {
    if (!(error instanceof DiscordError)) throw error;
    console.warn("Discord login failed", error.message);
    headers.set("Location", "/?login_error=discord");
    return new Response(null, { status: 302, headers });
  }

  const id = await upsertUser(deps.db, {
    discordId: profile.id,
    username: profile.username,
    avatar: profile.avatar,
    discordCreatedAt: profile.createdAt,
    guildMember,
  });
  deps.users.set(id, profile.username);
  // Checked inside the command: the player may be created concurrently by another socket.
  await deps.runtime.run((engine) => {
    if (engine.players.has(id)) engine.setAccess(id, { guildMember });
  });
  const { token, expiresAt } = await createSession(deps.db, id, deps.config.sessionTtlMs, Date.now());
  headers.append("Set-Cookie", sessionCookie(token, expiresAt, deps.config.secureCookies));
  return new Response(null, { status: 302, headers });
}
```

В `route()` (`apps/server/src/net/server.ts`) перед строкой dev-логина:
```ts
  if (req.method === "GET" && url.pathname === "/auth/discord" && deps.config.discord) return startDiscordLogin(deps);
  if (req.method === "GET" && url.pathname === "/auth/discord/callback" && deps.config.discord) return finishDiscordLogin(req, deps);
```
(импорт `import { finishDiscordLogin, startDiscordLogin } from "../auth/discord-routes";`).

- [ ] **Step 8: Запустить, убедиться что проходит**

Run: `bun test && bun run typecheck`
Expected: 0 fail, **177** pass (169 + env 3 + discord login 5); typecheck exit 0. Прогнать `server.test.ts` 3 раза подряд — без флаков.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(auth): add discord oauth login"
```

---

### Task 5: Выход закрывает сокеты сессии, чистка сессий

**Files:**
- Modify: `apps/server/src/net/hub.ts`, `apps/server/src/net/server.ts`, `apps/server/src/auth/session.ts`
- Test: `apps/server/src/auth/session.test.ts`, `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тесты**

В `apps/server/src/auth/session.test.ts` (`describe("sessions")`):
```ts
  test("deleteExpiredSessions removes only expired sessions", async () => {
    const id = await alice();
    const old = await createSession(t.db, id, DAY, T0);
    const fresh = await createSession(t.db, id, 10 * DAY, T0);
    expect(await deleteExpiredSessions(t.db, T0 + 2 * DAY)).toBe(1);
    expect(await resolveSession(t.db, old.token, T0)).toBeNull();
    expect(await resolveSession(t.db, fresh.token, T0)).not.toBeNull();
  });
```
(добавить `deleteExpiredSessions` в импорт).

В `apps/server/src/net/server.test.ts` (`describe("websocket")`):
```ts
  test("logout closes the sockets of that session only", async () => {
    const first = await login("alice");
    const second = await login("alice");
    const a = await connect(first);
    const b = await connect(second);
    await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: first } });
    expect(await a.closed).toBe(4001);
    b.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(b, 1)).result).toEqual({ ok: true, outcome: "placed" });
  });
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `bun test apps/server/src/auth/session.test.ts apps/server/src/net/server.test.ts`
Expected: FAIL — нет `deleteExpiredSessions`; сокет после выхода не закрывается.

- [ ] **Step 3: Реализовать**

`apps/server/src/auth/session.ts` (импорт `lt` из `drizzle-orm`):
```ts
/** Returns how many sessions were removed. */
export async function deleteExpiredSessions(db: Db, now: number): Promise<number> {
  const removed = await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).returning({ id: sessions.id });
  return removed.length;
}
```

`apps/server/src/net/hub.ts` — метод рядом с `closeAll`:
```ts
  /** Closes every socket authenticated with this session (logout). */
  disconnectSession(sessionId: string, code: number, reason: string): void {
    for (const ws of this.sockets) if (ws.data.user?.sessionId === sessionId) ws.close(code, reason);
  }
```

`apps/server/src/net/server.ts` — `logout` целиком:
```ts
/** Application close code: the session behind this socket ended. */
const CLOSE_LOGGED_OUT = 4001;

async function logout(req: Request, deps: AppDeps): Promise<Response> {
  const token = readSessionToken(req, deps.config.secureCookies);
  if (token) {
    await deleteSession(deps.db, token);
    deps.hub.disconnectSession(sessionIdOf(token), CLOSE_LOGGED_OUT, "logged out");
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(deps.config.secureCookies) } });
}
```
(импорт `sessionIdOf` из `../auth/session`).

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test && bun run typecheck`
Expected: 0 fail, **179** pass; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(auth): close session sockets on logout and purge expired sessions"
```

---

### Task 6: tRPC — инфраструктура и роутер

**Files:**
- Modify: `apps/server/package.json`, `apps/server/src/net/rate-limit.ts`, `apps/server/src/net/deps.ts`, `apps/server/src/net/server.ts`
- Create: `apps/server/src/trpc/init.ts`, `apps/server/src/trpc/router.ts`
- Test: `apps/server/src/net/rate-limit.test.ts`, `apps/server/src/trpc/router.test.ts`

- [ ] **Step 1: Зависимость**

Run: `bun add @trpc/server@11.19.0 --cwd apps/server`

- [ ] **Step 2: Тесты**

В `apps/server/src/net/rate-limit.test.ts`:
```ts
test("UserRateLimiter keeps a bucket per user", () => {
  let now = 0;
  const limiter = new UserRateLimiter(2, 1, () => now);
  expect([limiter.take(1), limiter.take(1), limiter.take(1)]).toEqual([true, true, false]);
  expect(limiter.take(2)).toBe(true);
  now = 1000;
  expect(limiter.take(1)).toBe(true);
});
```
(импорт `UserRateLimiter`).

`apps/server/src/trpc/router.test.ts`:
```ts
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { SessionUser } from "../auth/session";
import { createTestDb, insertUser } from "../db/test-db";
import type { AppDeps } from "../net/deps";
import type { ServerConfig } from "../net/env";
import { Hub } from "../net/hub";
import { UserRateLimiter } from "../net/rate-limit";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

const t = createTestDb();
const createCaller = createCallerFactory(appRouter);
const config: ServerConfig = {
  databaseUrl: "",
  port: 0,
  publicOrigin: "http://localhost:5173",
  allowedOrigins: new Set(["http://localhost:5173"]),
  devLogin: true,
  secureCookies: false,
  sessionTtlMs: 86_400_000,
  discord: null,
};

let runtime: GameRuntime;
let deps: AppDeps;
let alice: SessionUser;
let bob: SessionUser;

const sessionUser = (id: number, username: string): SessionUser => ({
  id,
  username,
  discordCreatedAt: Date.UTC(2020, 0, 1),
  bannedUntil: null,
  guildMember: true,
  sessionId: `s-${id}`,
});

beforeEach(async () => {
  await t.reset();
  alice = sessionUser(await insertUser(t.db, "alice"), "alice");
  bob = sessionUser(await insertUser(t.db, "bob"), "bob");
  const users = await UserDirectory.load(t.db);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  deps = { db: t.db, runtime, hub: new Hub({ runtime, users }), users, config };
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const as = (user: SessionUser | null, limiter = new UserRateLimiter(100, 100)) => createCaller({ deps, user, limiter });

describe("appRouter", () => {
  test("me is null for anonymous visitors and describes the player otherwise", async () => {
    expect(await as(null).me()).toBeNull();
    await as(alice).daily.claim();
    const me = await as(alice).me();
    expect(me?.user).toEqual({ id: alice.id, name: "alice" });
    expect(me?.player?.coins).toBe(130);
  });

  test("player actions require a session", async () => {
    await expect(as(null).daily.claim()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("shop purchases return engine results", async () => {
    expect(await as(alice).shop.buyItem({ item: "bomb" })).toEqual({ ok: true });
    expect(runtime.engine.players.get(alice.id).inventory.bomb).toBe(4);
    expect(await as(alice).shop.buyColor({ colorId: 3 })).toEqual({ ok: false, code: "not_for_sale" });
    expect(await as(alice).shop.buyChargeBoost()).toEqual({ ok: false, code: "insufficient_coins" });
  });

  test("daily can be claimed once per day", async () => {
    expect(await as(alice).daily.claim()).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
    expect(await as(alice).daily.claim()).toEqual({ ok: false, code: "already_claimed" });
  });

  test("detector counts and defuser removes another player's bomb", async () => {
    await runtime.addPlayer({ userId: bob.id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(bob.id, { x: 5, y: 5, colorId: 3, withBomb: true }, now));
    expect(await as(alice).tools.detect({ x: 4, y: 4 })).toEqual({ ok: true, count: 1 });
    expect(await as(alice).tools.defuse({ x: 5, y: 5 })).toEqual({ ok: false, code: "no_defuser" });
    await runtime.run((engine) => {
      engine.players.get(alice.id).inventory.defuser = 1;
    });
    expect(await as(alice).tools.defuse({ x: 5, y: 5 })).toEqual({ ok: true, found: true, reward: 20 });
    expect(runtime.engine.bombs.get(5, 5)).toBeUndefined();
  });

  test("invalid input is rejected before reaching the engine", async () => {
    await expect(as(alice).tools.detect({ x: -1, y: 0 })).rejects.toBeInstanceOf(TRPCError);
    await expect(as(alice).shop.buyColor({ colorId: 256 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("calls are rate limited per user", async () => {
    const limiter = new UserRateLimiter(2, 0.001);
    await as(alice, limiter).daily.claim();
    await as(alice, limiter).daily.claim();
    await expect(as(alice, limiter).daily.claim()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await as(bob, limiter).daily.claim()).toMatchObject({ ok: true });
  });
});
```

Заметка: прямое изменение `inventory.defuser` внутри `runtime.run` — только тестовая подготовка (как в тестах движка), не паттерн для кода приложения.

- [ ] **Step 3: Запустить, убедиться что падают**

Run: `bun test apps/server/src/net/rate-limit.test.ts apps/server/src/trpc/router.test.ts`
Expected: FAIL — нет `UserRateLimiter`, нет модулей `./init`, `./router`.

- [ ] **Step 4: `UserRateLimiter`**

В конец `apps/server/src/net/rate-limit.ts`:
```ts
/** One token bucket per user id. */
export class UserRateLimiter {
  private buckets = new Map<number, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(userId: number): boolean {
    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.perSecond, this.now());
      this.buckets.set(userId, bucket);
    }
    return bucket.take(this.now());
  }
}
```
В `apps/server/src/net/deps.ts` добавить поле `limiter?: UserRateLimiter;` и импорт типа (см. Task 4 Step 4).

- [ ] **Step 5: `trpc/init.ts`**

```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { SessionUser } from "../auth/session";
import type { AppDeps } from "../net/deps";
import type { UserRateLimiter } from "../net/rate-limit";

export interface TrpcContext {
  deps: AppDeps;
  user: SessionUser | null;
  limiter: UserRateLimiter;
}

const t = initTRPC.context<TrpcContext>().create({ isDev: process.env.NODE_ENV !== "production" });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** Logged-in, rate-limited, and guaranteed to have a player in the engine. */
export const playerProcedure = t.procedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.limiter.take(user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  await ctx.deps.runtime.addPlayer({
    userId: user.id,
    accountCreatedAt: user.discordCreatedAt,
    guildMember: user.guildMember,
    bannedUntil: user.bannedUntil,
  });
  return next({ ctx: { ...ctx, user } });
});
```

- [ ] **Step 6: `trpc/router.ts`**

```ts
import { itemKeySchema } from "@rave/shared";
import { z } from "zod";
import { toPlayerView } from "../net/views";
import { playerProcedure, publicProcedure, router } from "./init";

const cell = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

/**
 * Everything except pixels (those go over the WebSocket). Mutations run through the runtime, so
 * player updates and feed entries reach WebSocket clients via the commit hook.
 */
export const appRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const engine = ctx.deps.runtime.engine;
    const player = engine.players.has(ctx.user.id)
      ? toPlayerView(engine.players.get(ctx.user.id), engine.config, Date.now())
      : null;
    return { user: ctx.deps.users.ref(ctx.user.id), player };
  }),

  shop: router({
    buyItem: playerProcedure
      .input(z.object({ item: itemKeySchema }))
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.buyItem(ctx.user.id, input.item, now))),
    buyChargeBoost: playerProcedure.mutation(({ ctx }) =>
      ctx.deps.runtime.run((engine, now) => engine.buyChargeBoost(ctx.user.id, now)),
    ),
    buyColor: playerProcedure
      .input(z.object({ colorId: z.number().int().min(0).max(255) }))
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.buyColor(ctx.user.id, input.colorId, now))),
  }),

  daily: router({
    claim: playerProcedure.mutation(({ ctx }) => ctx.deps.runtime.run((engine, now) => engine.claimDaily(ctx.user.id, now))),
  }),

  tools: router({
    detect: playerProcedure
      .input(cell)
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.detect(ctx.user.id, input, now))),
    defuse: playerProcedure
      .input(cell)
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.defuse(ctx.user.id, input, now))),
  }),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 7: Запустить, убедиться что проходит**

Run: `bun test apps/server/src/net/rate-limit.test.ts apps/server/src/trpc/router.test.ts && bun run typecheck`
Expected: PASS (rate-limit 4, router 7); typecheck exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server bun.lock
git commit -m "feat(server): add trpc router for player actions"
```

---

### Task 7: tRPC по HTTP

**Files:**
- Modify: `apps/server/src/net/server.ts`
- Test: `apps/server/src/net/server.test.ts`

- [ ] **Step 1: Тесты**

В `apps/server/src/net/server.test.ts`:
```ts
describe("trpc over http", () => {
  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    fetch(`${base}/trpc/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  test("queries work with the session cookie", async () => {
    const cookie = await login("alice");
    const res = await fetch(`${base}/trpc/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).result.data.user.name).toBe("alice");
  });

  test("mutations require an allowed origin", async () => {
    const cookie = await login("alice");
    expect((await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie })).status).toBe(403);
    expect((await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie, Origin: "http://evil.test" })).status).toBe(403);
    const ok = await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie, Origin: ORIGIN });
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.data).toEqual({ ok: true, count: 0 });
  });

  test("a defuse through trpc reaches websocket clients as a feed entry", async () => {
    const bobCookie = await login("bob");
    const bob = await connect(bobCookie);
    bob.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(bob, 1);
    const aliceCookie = await login("alice");
    const viewer = await connect();
    const aliceId = (await (await fetch(`${base}/trpc/me`, { headers: { Cookie: aliceCookie } })).json()).result.data.user.id;
    await runtime.addPlayer({ userId: aliceId, accountCreatedAt: Date.UTC(2015, 0, 1), guildMember: true });
    await runtime.run((engine) => {
      engine.players.get(aliceId).inventory.defuser = 1;
    });
    const res = await post("tools.defuse", { x: 5, y: 5 }, { Cookie: aliceCookie, Origin: ORIGIN });
    expect((await res.json()).result.data).toEqual({ ok: true, found: true, reward: 20 });
    const feed = await waitFor(() => viewer.json.find((m) => m.type === "feed"));
    expect(feed).toMatchObject({ kind: "defused", actor: { name: "alice" }, owner: { name: "bob" } });
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `bun test apps/server/src/net/server.test.ts`
Expected: FAIL — `/trpc/...` отвечает 404.

- [ ] **Step 3: Реализовать**

В `apps/server/src/net/server.ts`:

1. Импорты:
```ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../trpc/router";
import { UserRateLimiter } from "./rate-limit";
```
2. `startServer` — один лимитер на сервер:
```ts
export function startServer(deps: AppDeps): Server<SocketData> {
  const limiter = deps.limiter ?? new UserRateLimiter(20, 5);
  const server = Bun.serve({
    port: deps.config.port,
    fetch: (req, srv) => route(req, srv, deps, limiter),
    websocket: deps.hub.websocket,
    // ... без изменений
  });
```
(сохранить остальные опции `Bun.serve`, если они есть в текущем коде; `route` получает четвёртый параметр `limiter: UserRateLimiter`).
3. В `route()` перед финальным 404:
```ts
  if (url.pathname.startsWith("/trpc/")) return trpc(req, deps, limiter);
```
4. Функция:
```ts
async function trpc(req: Request, deps: AppDeps, limiter: UserRateLimiter): Promise<Response> {
  // Cookie auth: state-changing calls must come from our own pages, like the WebSocket.
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || !deps.config.allowedOrigins.has(origin)) return new Response("Forbidden origin", { status: 403 });
  }
  const token = readSessionToken(req, deps.config.secureCookies);
  const user = token ? await resolveSession(deps.db, token, Date.now()) : null;
  return fetchRequestHandler({ endpoint: "/trpc", req, router: appRouter, createContext: () => ({ deps, user, limiter }) });
}
```

- [ ] **Step 4: Запустить, убедиться что проходит**

Run: `bun test && bun run typecheck`
Expected: 0 fail, **190** pass; typecheck exit 0. `server.test.ts` 3 раза подряд — без флаков.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): serve trpc with origin check"
```

---

### Task 8: Точка входа

**Files:**
- Modify: `apps/server/src/main.ts`, `.env.example`

- [ ] **Step 1: Чистка сессий в `main.ts`**

После `await runMigrations(db);`:
```ts
  const purgeSessions = () =>
    deleteExpiredSessions(db, Date.now()).catch((error) => console.error("Session cleanup failed", error));
  await purgeSessions();
  setInterval(purgeSessions, 60 * 60 * 1000).unref();
```
(импорт `deleteExpiredSessions` из `./auth/session`). Discord-конфиг уже приходит в `config` из `loadEnv` и через `deps` попадает в маршруты — других изменений `main.ts` не требует.

- [ ] **Step 2: `.env.example`**

Добавить в конец:
```
# Discord OAuth (required in production). Redirect URL to register in the Discord app:
#   <PUBLIC_URL origin>/auth/discord/callback
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
# Optional: only members of this guild can play.
DISCORD_GUILD_ID=
```

- [ ] **Step 3: Smoke**

Run (порт 3000 свободен; если занят — другой `PORT`):
```bash
bun apps/server/src/main.ts > tmp/server-2c.log 2>&1 & S=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/auth/discord
curl -s localhost:3000/trpc/me
C=$(curl -s -D - -o /dev/null "localhost:3000/auth/dev?name=smoke2c" | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
curl -s -H "Cookie: $C" localhost:3000/trpc/me; echo
curl -s -X POST -H "Cookie: $C" -H "Origin: http://localhost:5173" -H "Content-Type: application/json" -d '{}' localhost:3000/trpc/daily.claim; echo
kill -INT $S; wait $S; echo "exit: $?"
```
Expected: `404` (Discord не настроен в `.env`); `{"result":{"data":null}}`; `me` с `"name":"smoke2c"`; `daily.claim` → `{"result":{"data":{"ok":true,"reward":{"item":"coins","amount":30}}}}` (или `already_claimed`, если пользователь уже забирал сегодня); `exit: 0`. Если `daily.claim` без инпута с телом `{}` отвечает ошибкой формата, отметить это в отчёте — это важно для клиента (План 3).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/main.ts .env.example
git commit -m "feat(server): purge expired sessions and document discord env"
```

---

### Task 9: Финальная проверка

- [ ] **Step 1:** `bun test` — 0 fail, **190** pass (158 + 3 + 2 + 6 + 8 + 2 + 1 + 7 + 3).
- [ ] **Step 2:** `bun run typecheck` — exit 0.
- [ ] **Step 3:** `git status --short` — пусто; на порту 3000 ничего не слушает.
