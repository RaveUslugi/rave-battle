import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { eq } from "drizzle-orm";
import { createSession, resolveSession, type SessionUser } from "../auth/session";
import { gameConfig, ledger, modLog, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { ensurePlayer } from "../auth/ensure-player";
import { banFromDate } from "../persistence/codec";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { StatsService } from "../stats/service";
import { AccessQueue } from "./access-queue";
import { AdminService } from "./service";

const t = createTestDb();
let runtime: GameRuntime;
let service: AdminService;
let stats: StatsService;
let accessQueue: AccessQueue;
let admin: SessionUser;
let ann: number;
let bob: number;

const sessionUser = (id: number, name: string): SessionUser => ({
  id,
  username: name,
  discordCreatedAt: Date.UTC(2020, 0, 1),
  bannedUntil: null,
  guildMember: true,
  discordId: `discord-${name}`,
  banReason: null,
  sessionId: `s-${id}`,
});

const join = (userId: number) => runtime.addPlayer({ userId, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
const place = (userId: number) => runtime.run((e, now) => e.placePixel(userId, { x: 1, y: 1, colorId: 3, withBomb: false }, now));
const logRows = () => t.db.select().from(modLog).orderBy(modLog.id);

beforeEach(async () => {
  await t.reset();
  const adminId = await insertUser(t.db, "admin");
  admin = sessionUser(adminId, "admin");
  ann = await insertUser(t.db, "ann");
  bob = await insertUser(t.db, "bob_x");
  const dir = await UserDirectory.load(t.db);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  stats = new StatsService(t.db, runtime, dir);
  accessQueue = new AccessQueue();
  service = new AdminService({
    db: t.db,
    runtime,
    users: dir,
    stats,
    accessQueue,
    isAdmin: (discordId) => discordId === "discord-admin",
  });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

describe("search", () => {
  test("finds by part of the name, by id and by discord id", async () => {
    expect((await service.search("an")).map((r) => r.id)).toEqual([ann]);
    expect((await service.search(String(bob))).map((r) => r.id)).toEqual([bob]);
    expect((await service.search("discord-ann")).map((r) => r.id)).toEqual([ann]);
    expect(await service.search("zzz")).toEqual([]);
  });

  test("% and _ are literal characters, not wildcards", async () => {
    expect(await service.search("%")).toEqual([]);
    expect((await service.search("bo_")).map((r) => r.id)).toEqual([]);
    expect((await service.search("bob_x")).map((r) => r.id)).toEqual([bob]);
  });

  test("a backslash in the query is literal and does not break the query", async () => {
    const slash = await insertUser(t.db, "a\\b");
    expect((await service.search("a\\b")).map((r) => r.id)).toEqual([slash]);
    expect(await service.search("\\")).toHaveLength(1);
  });
});

describe("ban", () => {
  test("writes users and mod_log, updates the engine, blocks placing and refreshes rankings at once", async () => {
    await join(bob);
    await place(bob);
    expect((await stats.leaderboards.ranking("artists", "all")).map((r) => r.userId)).toEqual([bob]);

    expect(await service.ban(admin, { userId: bob, until: "permanent", reason: "spam" })).toEqual({ ok: true });

    const [row] = await t.db.select().from(users).where(eq(users.id, bob));
    expect(row!.bannedUntil).not.toBeNull();
    expect(row!.banReason).toBe("spam");
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "ban", adminId: admin.id, targetUserId: bob, params: { until: "permanent", reason: "spam" } });
    const p = runtime.engine.players.get(bob);
    expect(p.bannedUntil).toBe(Number.POSITIVE_INFINITY);
    expect(p.banReason).toBe("spam");
    expect(await place(bob)).toEqual({ ok: false, code: "banned" });
    expect(await stats.leaderboards.ranking("artists", "all")).toEqual([]);
  });

  test("rejects self, admins, a past end time and unknown users", async () => {
    expect(await service.ban(admin, { userId: admin.id, until: "permanent", reason: "x" })).toEqual({ ok: false, code: "self" });
    const other = sessionUser(ann, "ann");
    const adminTarget = await insertUser(t.db, "admin2");
    // discord-admin2 is not an admin; make the target one through the predicate.
    const strict = new AdminService({
      db: t.db,
      runtime,
      users: await UserDirectory.load(t.db),
      stats: stats,
      accessQueue,
      isAdmin: (d) => d === "discord-admin2",
    });
    expect(await strict.ban(other, { userId: adminTarget, until: "permanent", reason: "x" })).toEqual({ ok: false, code: "target_is_admin" });
    expect(await service.ban(admin, { userId: ann, until: Date.now() - 1000, reason: "x" })).toEqual({ ok: false, code: "bad_until" });
    expect(await service.ban(admin, { userId: 9999, until: "permanent", reason: "x" })).toEqual({ ok: false, code: "not_found" });
    expect(await logRows()).toHaveLength(0);
  });

  test("a player not in the engine is banned in the DB only and arrives banned", async () => {
    expect(await service.ban(admin, { userId: ann, until: Date.now() + 3_600_000, reason: "later" })).toEqual({ ok: true });
    expect(runtime.engine.players.has(ann)).toBe(false);
    const { token } = await createSession(t.db, ann, 86_400_000, Date.now());
    const session = (await resolveSession(t.db, token, Date.now()))!;
    const { player: p } = await runtime.addPlayer({
      userId: ann,
      accountCreatedAt: session.discordCreatedAt,
      guildMember: session.guildMember,
      bannedUntil: session.bannedUntil,
      banReason: session.banReason,
    });
    expect(p.banReason).toBe("later");
    expect(await place(ann)).toEqual({ ok: false, code: "banned" });
  });
});

describe("unban", () => {
  test("clears the ban, logs it and rejects a repeat", async () => {
    await join(bob);
    await service.ban(admin, { userId: bob, until: "permanent", reason: "spam" });
    expect(await service.unban(admin, { userId: bob, reason: "sorry" })).toEqual({ ok: true });
    const [row] = await t.db.select().from(users).where(eq(users.id, bob));
    expect(row).toMatchObject({ bannedUntil: null, banReason: null });
    expect((await logRows()).map((r) => r.action)).toEqual(["ban", "unban"]);
    expect((await logRows())[1]!.params).toEqual({ reason: "sorry" });
    expect(runtime.engine.players.get(bob).bannedUntil).toBeNull();
    expect(await service.unban(admin, { userId: bob, reason: "again" })).toEqual({ ok: false, code: "not_banned" });
  });

  test("an already expired ban is not_banned", async () => {
    await t.db
      .update(users)
      .set({ bannedUntil: new Date(Date.now() - 60_000), banReason: "old" })
      .where(eq(users.id, bob));
    expect(await service.unban(admin, { userId: bob, reason: "x" })).toEqual({ ok: false, code: "not_banned" });
    expect(await logRows()).toHaveLength(0);
  });

  test("two parallel unbans of one player write exactly one unban entry", async () => {
    await join(bob);
    await service.ban(admin, { userId: bob, until: "permanent", reason: "r" });
    const results = await Promise.all([service.unban(admin, { userId: bob, reason: "a" }), service.unban(admin, { userId: bob, reason: "b" })]);
    expect(results).toEqual([{ ok: true }, { ok: false, code: "not_banned" }]);
    expect((await logRows()).filter((r) => r.action === "unban")).toHaveLength(1);
  });

  test("ensurePlayer and unban in parallel leave the engine and the DB in agreement", async () => {
    for (let i = 0; i < 20; i++) {
      const id = await insertUser(t.db, `racer${i}`);
      // The ban landed after the session was resolved: the session says "not banned", the DB says banned.
      await t.db
        .update(users)
        .set({ bannedUntil: new Date(Date.now() + 3_600_000), banReason: "seed" })
        .where(eq(users.id, id));
      const stale = sessionUser(id, `racer${i}`);
      await Promise.all([ensurePlayer({ db: t.db, runtime, accessQueue }, stale), service.unban(admin, { userId: id, reason: "x" })]);
      const [row] = await t.db.select().from(users).where(eq(users.id, id));
      expect(row!.bannedUntil).toBeNull();
      expect(runtime.engine.players.get(id).bannedUntil).toBeNull();
    }
  });

  test("concurrent ban and unban leave the DB and the engine in agreement", async () => {
    await join(bob);
    for (const order of ["ban-first", "unban-first"]) {
      const ban = () => service.ban(admin, { userId: bob, until: "permanent", reason: "r" });
      const unban = () => service.unban(admin, { userId: bob, reason: "r" });
      // unban needs an active ban to be accepted
      await t.db
        .update(users)
        .set({ bannedUntil: new Date(Date.now() + 3_600_000), banReason: "seed" })
        .where(eq(users.id, bob));
      await Promise.all(order === "ban-first" ? [ban(), unban()] : [unban(), ban()]);
      const [row] = await t.db.select().from(users).where(eq(users.id, bob));
      const inDb = banFromDate(row!.bannedUntil);
      expect(runtime.engine.players.get(bob).bannedUntil).toBe(inDb);
      expect(runtime.engine.players.get(bob).banReason).toBe(row!.banReason);
    }
  });
});

describe("adjust", () => {
  test("changes the balance with admin ledger rows and a player_edit log entry", async () => {
    await join(bob);
    const before = runtime.engine.players.get(bob).coins;
    expect(await service.adjust(admin, { userId: bob, changes: { coins: 50, bomb: 2 }, comment: "gift" })).toEqual({ ok: true });
    expect(runtime.engine.players.get(bob).coins).toBe(before + 50);
    const rows = await t.db.select().from(ledger).where(eq(ledger.reason, "admin"));
    expect(rows.map((r) => r.item).sort()).toEqual(["bomb", "coins"]);
    expect((await logRows()).map((r) => r.action)).toEqual(["player_edit"]);
    expect(await service.adjust(admin, { userId: bob, changes: { coins: -1_000_000 }, comment: "x" })).toEqual({ ok: false, code: "negative_balance" });
    expect(await service.adjust(admin, { userId: bob, changes: {}, comment: "x" })).toEqual({ ok: false, code: "nothing_to_change" });
  });

  test("a player who never entered the game is not_found", async () => {
    expect(await service.adjust(admin, { userId: ann, changes: { coins: 5 }, comment: "x" })).toEqual({ ok: false, code: "not_found" });
  });
});

describe("player", () => {
  test("returns user info, engine state and the latest log entries", async () => {
    expect((await service.player(ann))!.state).toBeNull();
    await join(bob);
    await place(bob);
    await service.ban(admin, { userId: bob, until: "permanent", reason: "r" });
    const view = (await service.player(bob))!;
    expect(view.user).toMatchObject({ id: bob, name: "bob_x", bannedUntil: "permanent", banReason: "r" });
    expect(view.state).toMatchObject({ territory: 1, activeBombs: 0, unlimited: false });
    expect(view.log.map((l) => l.action)).toEqual(["ban"]);
    expect(await service.player(9999)).toBeNull();
  });
});

describe("config", () => {
  const draft = () => structuredClone(defaultConfig);

  test("saveConfig reports invalid fields with dotted paths", async () => {
    const bad = draft();
    bad.charges.max = -1;
    const result = await service.saveConfig(admin, { baseVersion: 1, config: bad, comment: "x" });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (!result.ok && result.code === "invalid") expect(result.issues.map((i) => i.path)).toContain("charges.max");
  });

  test("saveConfig rejects a stale base version", async () => {
    expect(await service.saveConfig(admin, { baseVersion: 7, config: draft(), comment: "x" })).toEqual({ ok: false, code: "stale", currentVersion: 1 });
  });

  test("saveConfig stores a new version with author and comment and logs it", async () => {
    const next = draft();
    next.charges.max = 7;
    expect(await service.saveConfig(admin, { baseVersion: 1, config: next, comment: "tweak" })).toEqual({ ok: true, version: 2 });
    const [row] = await t.db.select().from(gameConfig).where(eq(gameConfig.version, 2));
    expect(row).toMatchObject({ createdBy: admin.id, comment: "tweak" });
    expect(runtime.engine.config.charges.max).toBe(7);
    expect((await logRows()).map((r) => r.action)).toEqual(["config_save"]);
  });

  test("rollbackConfig re-applies an old version as a new one", async () => {
    const next = draft();
    next.charges.max = 7;
    await service.saveConfig(admin, { baseVersion: 1, config: next, comment: "tweak" });
    expect(await service.rollbackConfig(admin, { version: 1, baseVersion: 2, comment: "undo" })).toEqual({ ok: true, version: 3 });
    expect(await service.configVersion(3)).toEqual(await service.configVersion(1));
    expect(runtime.engine.config.charges.max).toBe(defaultConfig.charges.max);
    expect((await service.history()).map((h) => h.version)).toEqual([3, 2, 1]);
    expect(await service.rollbackConfig(admin, { version: 99, baseVersion: 3, comment: "x" })).toEqual({ ok: false, code: "not_found" });
  });

  test("an old version that no longer passes the schema is invalid for get and rollback", async () => {
    const { palette: _palette, ...old } = draft();
    await t.db.insert(gameConfig).values({ version: 2, data: old, comment: "legacy" });
    const got = await service.configVersion(2);
    expect(got).toMatchObject({ ok: false, code: "invalid" });
    if (!got.ok && got.code === "invalid") expect(got.issues.map((i) => i.path)).toContain("palette");
    expect(await service.rollbackConfig(admin, { version: 2, baseVersion: 1, comment: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await service.configVersion(99)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("modLog", () => {
  test("pages by cursor and filters by action and target", async () => {
    await t.db.insert(modLog).values(
      Array.from({ length: 60 }, (_, i) => ({
        adminId: admin.id,
        action: i % 2 === 0 ? ("ban" as const) : ("unban" as const),
        targetUserId: i < 10 ? ann : bob,
        params: {},
      })),
    );
    const first = await service.modLog({});
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]!.id).toBe(60);
    expect(first.next).toBe(11);
    const second = await service.modLog({ before: first.next! });
    expect(second.entries).toHaveLength(10);
    expect(second.next).toBeNull();
    expect(first.entries[0]!.admin).toEqual({ id: admin.id, name: "admin" });
    expect((await service.modLog({ action: "ban" })).entries.every((e) => e.action === "ban")).toBe(true);
    const forAnn = await service.modLog({ targetUserId: ann });
    expect(forAnn.entries).toHaveLength(10);
    expect(forAnn.entries.every((e) => e.target?.id === ann)).toBe(true);
  });
});

describe("canvas inspector and moderation", () => {
  const NOW = Date.now();
  const placeAt = async (userId: number, x: number, y: number, colorId: number, at: number, withBomb = false) => {
    const res = await runtime.run((e) => e.placePixel(userId, { x, y, colorId, withBomb }, at));
    expect(res).toMatchObject({ ok: true });
  };
  const joinUnlimited = async (id: number) => {
    await join(id);
    runtime.engine.grantUnlimited(id);
  };

  test("inspect returns owner, bomb with owner and history newest first, capped at 20", async () => {
    await joinUnlimited(ann);
    await joinUnlimited(bob);
    for (let i = 0; i < 25; i++) await placeAt(i % 2 === 0 ? ann : bob, 4, 4, 3 + (i % 2), NOW - 100_000 + i * 1000, i === 24);
    const view = (await service.inspect(4, 4))!;
    expect(view).toMatchObject({ x: 4, y: 4, colorId: 3, owner: { id: ann, name: "ann" } });
    expect(view.bomb).toMatchObject({ owner: { id: ann, name: "ann" } });
    expect(view.history).toHaveLength(20);
    expect(view.history[0]).toMatchObject({ user: { id: ann }, colorId: 3, prevColorId: 4, kind: "place" });
    expect(view.history[0]!.at).toBeGreaterThan(view.history[1]!.at);
    expect(await service.inspect(9, 9)).toMatchObject({ owner: null, bomb: null, history: [] });
    expect(await service.inspect(-1, 0)).toBeNull();
    expect(await service.inspect(1_000_000, 0)).toBeNull();
  });

  test("preview and apply a player rollback, logging the counters", async () => {
    await joinUnlimited(ann);
    await placeAt(ann, 2, 2, 3, NOW - 10_000);
    const action = { kind: "rollback_player", userId: ann, from: NOW - 20_000, to: NOW, area: null, removeBombs: false } as const;
    expect(await service.previewModeration(action)).toEqual({ ok: true, cells: 1, bombs: 0, bbox: { x1: 2, y1: 2, x2: 2, y2: 2 } });
    expect(await service.applyModeration(admin, action)).toEqual({ ok: true, cells: 1, skipped: 0, bombs: 0 });
    expect(runtime.engine.canvas.get(2, 2)).toMatchObject({ colorId: 0, ownerId: 0 });
    await runtime.flush();
    const [row] = (await logRows()).filter((r) => r.action === "rollback_player");
    expect(row).toMatchObject({ adminId: admin.id, targetUserId: ann });
    expect(row!.params).toMatchObject({ cells: 1, skipped: 0, bombs: 0 });
  });

  test("remove_bombs preview reports the count but no bbox", async () => {
    await joinUnlimited(ann);
    await placeAt(ann, 6, 6, 3, NOW - 5000, true);
    expect(await service.previewModeration({ kind: "remove_bombs", userId: ann })).toEqual({ ok: true, cells: 0, bombs: 1, bbox: null });
  });

  test("apply reports plan errors", async () => {
    expect(await service.applyModeration(admin, { kind: "clear_area", area: { x1: 0, y1: 0, x2: 9999, y2: 0 }, mode: "fill" })).toEqual({
      ok: false,
      code: "bad_area",
    });
    expect(await service.previewModeration({ kind: "remove_bombs", userId: 99999 })).toEqual({ ok: false, code: "not_found" });
  });

  test("concurrent applies run one after another", async () => {
    await joinUnlimited(ann);
    await placeAt(ann, 2, 2, 3, NOW - 10_000);
    const action = { kind: "rollback_player", userId: ann, from: NOW - 20_000, to: NOW, area: null, removeBombs: false } as const;
    const [a, b] = await Promise.all([service.applyModeration(admin, action), service.applyModeration(admin, action)]);
    expect(a).toEqual({ ok: true, cells: 1, skipped: 0, bombs: 0 });
    expect(b).toEqual({ ok: true, cells: 0, skipped: 0, bombs: 0 });
  });

  test("areaOwners sorts authors by cell count", async () => {
    await joinUnlimited(ann);
    await joinUnlimited(bob);
    await placeAt(bob, 1, 1, 3, NOW - 5000);
    await placeAt(ann, 2, 1, 3, NOW - 4000);
    await placeAt(ann, 3, 1, 3, NOW - 3000);
    expect(service.areaOwners({ x1: 0, y1: 0, x2: 5, y2: 5 })).toEqual({
      ok: true,
      owners: [
        { user: { id: ann, name: "ann" }, cells: 2 },
        { user: { id: bob, name: "bob_x" }, cells: 1 },
      ],
    });
    expect(service.areaOwners({ x1: 0, y1: 0, x2: 256, y2: 255 })).toEqual({ ok: false, code: "area_too_large" });
  });
});
