import { gameConfigSchema, type GameConfig, type ItemKey, type Rect, type UserRef } from "@rave/shared";
import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { gameConfig, modLog, pixelEvents, users } from "../db/schema";
import { chargeCap, settleCharges } from "../engine/charges";
import type { ConfigIssue } from "../engine/config-change";
import type { ConfigResult, ModAction, PixelKind } from "../engine/types";
import type { UserDirectory } from "../net/user-directory";
import { banFromDate, banToDate } from "../persistence/codec";
import type { GameRuntime } from "../persistence/runtime";
import type { StatsService } from "../stats/service";
import { ModerationPlanner, summarize, validateArea, type ModerationAction, type PlanError } from "./moderation";

const SEARCH_LIMIT = 20;
const LOG_PAGE = 50;
const PLAYER_LOG = 20;
const HISTORY_LIMIT = 50;
const MAX_ID = 2_147_483_647;
const CELL_HISTORY = 20;
const AREA_OWNERS_TOP = 20;

export type AdminActionResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "self" | "target_is_admin" | "bad_until" | "not_banned" | "nothing_to_change" | "negative_balance" };

export type ConfigAnswer = ConfigResult | { ok: false; code: "not_found" };

/** A stored config version, re-validated against the current schema (old versions may no longer pass). */
export type ConfigVersionAnswer =
  | { ok: true; config: GameConfig }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid"; issues: ConfigIssue[] };

export interface ModLogEntry {
  id: number;
  admin: UserRef;
  action: ModAction;
  target: UserRef | null;
  params: Record<string, unknown>;
  at: number;
}

export interface AdminPlayer {
  user: {
    id: number;
    name: string;
    discordId: string;
    createdAt: number;
    discordCreatedAt: number;
    lastSeenAt: number | null;
    guildMember: boolean;
    bannedUntil: number | "permanent" | null;
    banReason: string | null;
  };
  /** Null when the player has never entered the game (not loaded in the engine). */
  state: {
    coins: number;
    inventory: Record<ItemKey, number>;
    charges: number;
    chargeCap: number;
    frozenUntil: number;
    unlimited: boolean;
    activeBombs: number;
    territory: number;
  } | null;
  log: ModLogEntry[];
}

export interface CellInspection {
  x: number;
  y: number;
  colorId: number;
  owner: UserRef | null;
  /** The only place bomb data leaves the server (admin cell inspector). */
  bomb: { owner: UserRef; createdAt: number } | null;
  history: Array<{ at: number; user: UserRef | null; colorId: number; prevColorId: number; kind: PixelKind }>;
}

export type ModerationPreview = { ok: true; cells: number; bombs: number; bbox: Rect | null } | { ok: false; code: PlanError };
export type ModerationOutcome = { ok: true; cells: number; skipped: number; bombs: number } | { ok: false; code: PlanError };

export interface AdminServiceDeps {
  db: Db;
  runtime: GameRuntime;
  users: UserDirectory;
  stats: StatsService;
  isAdmin: (discordId: string) => boolean;
  now?: () => number;
}

const toIssues = (issues: Array<{ path: PropertyKey[]; message: string }>): ConfigIssue[] =>
  issues.map((i) => ({ path: i.path.join("."), message: i.message }));

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AdminService {
  private readonly now: () => number;
  private readonly planner: ModerationPlanner;
  /** Moderation applies run one at a time, so every plan is computed against the previous apply's result. */
  private applyQueue: Promise<unknown> = Promise.resolve();
  /** Ban/unban writes are serialized per user so the DB and the engine always end up agreeing. */
  private readonly accessQueues = new Map<number, Promise<void>>();

  constructor(private deps: AdminServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.planner = new ModerationPlanner({ db: deps.db, runtime: deps.runtime, now: deps.now });
  }

  async inspect(x: number, y: number): Promise<CellInspection | null> {
    const { engine, season } = this.deps.runtime;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !engine.canvas.inBounds(x, y)) return null;
    // Commit first so the history matches the live cell.
    await this.deps.runtime.flush();
    const dir = this.deps.users;
    const cell = engine.canvas.get(x, y);
    const bomb = engine.bombs.get(x, y);
    const rows = await this.deps.db
      .select()
      .from(pixelEvents)
      .where(and(eq(pixelEvents.seasonId, season), eq(pixelEvents.x, x), eq(pixelEvents.y, y)))
      .orderBy(desc(pixelEvents.id))
      .limit(CELL_HISTORY);
    return {
      x,
      y,
      colorId: cell.colorId,
      owner: cell.ownerId === 0 ? null : dir.ref(cell.ownerId),
      bomb: bomb ? { owner: dir.ref(bomb.ownerId), createdAt: bomb.createdAt } : null,
      history: rows.map((r) => ({
        at: r.createdAt.getTime(),
        user: r.userId === null ? null : dir.ref(r.userId),
        colorId: r.colorId,
        prevColorId: r.prevColorId,
        kind: r.kind,
      })),
    };
  }

  /** Counts cells per owner in the area, top authors first. */
  areaOwners(area: Rect): { ok: true; owners: Array<{ user: UserRef; cells: number }> } | { ok: false; code: PlanError } {
    const canvas = this.deps.runtime.engine.canvas;
    const bad = validateArea(area, canvas);
    if (bad) return { ok: false, code: bad };
    const counts = new Map<number, number>();
    for (let y = area.y1; y <= area.y2; y++) {
      for (let x = area.x1; x <= area.x2; x++) {
        const { ownerId } = canvas.get(x, y);
        if (ownerId !== 0) counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
      }
    }
    const owners = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, AREA_OWNERS_TOP)
      .map(([id, cells]) => ({ user: this.deps.users.ref(id), cells }));
    return { ok: true, owners };
  }

  async previewModeration(action: ModerationAction): Promise<ModerationPreview> {
    // Commit first: the planner reads pixel_events, which must include every accepted pixel.
    await this.deps.runtime.flush();
    const res = await this.planner.plan(action);
    return res.ok ? { ok: true, ...summarize(res.planned) } : res;
  }

  applyModeration(admin: SessionUser, action: ModerationAction): Promise<ModerationOutcome> {
    const job = this.applyQueue.then(async (): Promise<ModerationOutcome> => {
      await this.deps.runtime.flush();
      const res = await this.planner.plan(action);
      if (!res.ok) return res;
      const { plan, meta } = res.planned;
      return this.deps.runtime.run((engine, now) => engine.applyModeration(plan, { ...meta, adminId: admin.id }, now));
    });
    this.applyQueue = job.catch(() => {});
    return job;
  }

  async search(q: string): Promise<Array<{ id: number; name: string; discordId: string; banned: boolean }>> {
    const query = q.trim();
    if (query.length < 1 || query.length > 64) return [];
    const conditions: SQL[] = [ilike(users.username, `%${escapeLike(query)}%`), eq(users.discordId, query)];
    if (/^\d+$/.test(query)) {
      const id = Number(query);
      if (id >= 1 && id <= MAX_ID) conditions.push(eq(users.id, id));
    }
    const rows = await this.deps.db
      .select({ id: users.id, name: users.username, discordId: users.discordId, bannedUntil: users.bannedUntil })
      .from(users)
      .where(or(...conditions))
      .orderBy(users.id)
      .limit(SEARCH_LIMIT);
    const now = this.now();
    return rows.map((r) => ({ id: r.id, name: r.name, discordId: r.discordId, banned: r.bannedUntil !== null && r.bannedUntil.getTime() > now }));
  }

  async player(userId: number): Promise<AdminPlayer | null> {
    const [row] = await this.deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return null;
    const engine = this.deps.runtime.engine;
    let state: AdminPlayer["state"] = null;
    if (engine.players.has(userId)) {
      const p = engine.players.get(userId);
      const settled = { ...p };
      settleCharges(settled, engine.config, this.now());
      state = {
        coins: p.coins,
        inventory: { ...p.inventory },
        charges: settled.charges,
        chargeCap: chargeCap(p, engine.config),
        frozenUntil: p.frozenUntil,
        unlimited: engine.isUnlimited(userId),
        activeBombs: engine.bombs.activeCount(userId),
        territory: engine.canvas.territoryOf(userId),
      };
    }
    const { entries } = await this.modLog({ targetUserId: userId }, PLAYER_LOG);
    const ban = banFromDate(row.bannedUntil);
    return {
      user: {
        id: row.id,
        name: row.username,
        discordId: row.discordId,
        createdAt: row.createdAt.getTime(),
        discordCreatedAt: row.discordCreatedAt.getTime(),
        lastSeenAt: row.lastSeenAt?.getTime() ?? null,
        guildMember: row.guildMember,
        bannedUntil: ban === null ? null : Number.isFinite(ban) ? ban : "permanent",
        banReason: row.banReason,
      },
      state,
      log: entries,
    };
  }

  async ban(admin: SessionUser, input: { userId: number; until: number | "permanent"; reason: string }): Promise<AdminActionResult> {
    const [target] = await this.deps.db.select({ discordId: users.discordId }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) return { ok: false, code: "not_found" };
    if (input.userId === admin.id) return { ok: false, code: "self" };
    if (this.deps.isAdmin(target.discordId)) return { ok: false, code: "target_is_admin" };
    const until = input.until === "permanent" ? Number.POSITIVE_INFINITY : input.until;
    if (until <= this.now()) return { ok: false, code: "bad_until" };
    await this.writeAccess(admin, input.userId, until, input.reason, "ban", { until: input.until, reason: input.reason });
    return { ok: true };
  }

  async unban(admin: SessionUser, input: { userId: number; reason: string }): Promise<AdminActionResult> {
    const [target] = await this.deps.db.select({ bannedUntil: users.bannedUntil }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) return { ok: false, code: "not_found" };
    if (target.bannedUntil === null || target.bannedUntil.getTime() <= this.now()) return { ok: false, code: "not_banned" };
    await this.writeAccess(admin, input.userId, null, null, "unban", { reason: input.reason });
    return { ok: true };
  }

  async adjust(
    admin: SessionUser,
    input: { userId: number; changes: Partial<Record<"coins" | ItemKey, number>>; comment: string },
  ): Promise<AdminActionResult> {
    return this.deps.runtime.run((engine, now): AdminActionResult => {
      if (!engine.players.has(input.userId)) return { ok: false, code: "not_found" };
      return engine.adminAdjust(input.userId, input.changes, now, { adminId: admin.id, comment: input.comment });
    });
  }

  async modLog(
    input: { action?: ModAction; targetUserId?: number; before?: number },
    pageSize = LOG_PAGE,
  ): Promise<{ entries: ModLogEntry[]; next: number | null }> {
    const conditions: SQL[] = [];
    if (input.action !== undefined) conditions.push(eq(modLog.action, input.action));
    if (input.targetUserId !== undefined) conditions.push(eq(modLog.targetUserId, input.targetUserId));
    if (input.before !== undefined) conditions.push(lt(modLog.id, input.before));
    const rows = await this.deps.db
      .select()
      .from(modLog)
      .where(and(...conditions))
      .orderBy(desc(modLog.id))
      .limit(pageSize + 1);
    const page = rows.slice(0, pageSize);
    const { users: dir } = this.deps;
    return {
      entries: page.map((r) => ({
        id: r.id,
        admin: dir.ref(r.adminId),
        action: r.action,
        target: r.targetUserId === null ? null : dir.ref(r.targetUserId),
        params: r.params,
        at: r.createdAt.getTime(),
      })),
      next: rows.length > pageSize ? page[page.length - 1]!.id : null,
    };
  }

  currentConfig(): { version: number; config: GameConfig } {
    const engine = this.deps.runtime.engine;
    return { version: engine.configVersion, config: engine.config };
  }

  async history(): Promise<Array<{ version: number; createdBy: UserRef | null; comment: string; createdAt: number }>> {
    const rows = await this.deps.db
      .select({ version: gameConfig.version, createdBy: gameConfig.createdBy, comment: gameConfig.comment, createdAt: gameConfig.createdAt })
      .from(gameConfig)
      .orderBy(desc(gameConfig.version))
      .limit(HISTORY_LIMIT);
    return rows.map((r) => ({
      version: r.version,
      createdBy: r.createdBy === null ? null : this.deps.users.ref(r.createdBy),
      comment: r.comment,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async configVersion(version: number): Promise<ConfigVersionAnswer> {
    const [row] = await this.deps.db.select({ data: gameConfig.data }).from(gameConfig).where(eq(gameConfig.version, version)).limit(1);
    if (!row) return { ok: false, code: "not_found" };
    const parsed = gameConfigSchema.safeParse(row.data);
    if (!parsed.success) return { ok: false, code: "invalid", issues: toIssues(parsed.error.issues) };
    return { ok: true, config: parsed.data };
  }

  async saveConfig(admin: SessionUser, input: { baseVersion: number; config: unknown; comment: string }): Promise<ConfigAnswer> {
    return this.applyParsed(admin, input.config, { baseVersion: input.baseVersion, comment: input.comment, action: "config_save" });
  }

  async rollbackConfig(admin: SessionUser, input: { version: number; baseVersion: number; comment: string }): Promise<ConfigAnswer> {
    const old = await this.configVersion(input.version);
    if (!old.ok) return old;
    return this.applyParsed(admin, old.config, {
      baseVersion: input.baseVersion,
      comment: input.comment,
      action: "config_rollback",
      fromVersion: input.version,
    });
  }

  private applyParsed(
    admin: SessionUser,
    raw: unknown,
    change: { baseVersion: number; comment: string; action: "config_save" | "config_rollback"; fromVersion?: number },
  ): Promise<ConfigResult> {
    const parsed = gameConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return Promise.resolve({ ok: false, code: "invalid", issues: toIssues(parsed.error.issues) });
    }
    // The engine keeps the parsed object as the live config, so it must not be shared with anything else.
    return this.deps.runtime.run((engine, now) => engine.applyConfig(parsed.data, { ...change, adminId: admin.id }, now));
  }

  /** Persists a ban/unban with its log row, then pushes it to the engine and drops cached rankings. */
  private writeAccess(
    admin: SessionUser,
    userId: number,
    until: number | null,
    reason: string | null,
    action: "ban" | "unban",
    params: Record<string, unknown>,
  ): Promise<void> {
    const previous = this.accessQueues.get(userId) ?? Promise.resolve();
    const job = previous.then(() => this.writeAccessNow(admin, userId, until, reason, action, params));
    const tail = job.catch(() => {});
    this.accessQueues.set(userId, tail);
    void tail.then(() => {
      if (this.accessQueues.get(userId) === tail) this.accessQueues.delete(userId);
    });
    return job;
  }

  private async writeAccessNow(
    admin: SessionUser,
    userId: number,
    until: number | null,
    reason: string | null,
    action: "ban" | "unban",
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await tx.update(users).set({ bannedUntil: banToDate(until), banReason: reason }).where(eq(users.id, userId));
      await tx.insert(modLog).values({ adminId: admin.id, action, targetUserId: userId, params });
    });
    await this.deps.runtime.run((engine) => {
      if (engine.players.has(userId)) engine.setAccess(userId, { bannedUntil: until, banReason: reason });
    });
    this.deps.stats.leaderboards.invalidate();
  }
}
