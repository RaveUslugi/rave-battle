import { gameConfigSchema, type GameConfig, type ItemKey, type UserRef } from "@rave/shared";
import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { gameConfig, modLog, users } from "../db/schema";
import { chargeCap, settleCharges } from "../engine/charges";
import type { ConfigIssue } from "../engine/config-change";
import type { ConfigResult, ModAction } from "../engine/types";
import type { UserDirectory } from "../net/user-directory";
import { banFromDate, banToDate } from "../persistence/codec";
import type { GameRuntime } from "../persistence/runtime";
import type { StatsService } from "../stats/service";

const SEARCH_LIMIT = 20;
const LOG_PAGE = 50;
const PLAYER_LOG = 20;
const HISTORY_LIMIT = 50;
const MAX_ID = 2_147_483_647;

export type AdminActionResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "self" | "target_is_admin" | "bad_until" | "not_banned" | "nothing_to_change" | "negative_balance" };

export type ConfigAnswer = ConfigResult | { ok: false; code: "not_found" };

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

export interface AdminServiceDeps {
  db: Db;
  runtime: GameRuntime;
  users: UserDirectory;
  stats: StatsService;
  isAdmin: (discordId: string) => boolean;
  now?: () => number;
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AdminService {
  private readonly now: () => number;

  constructor(private deps: AdminServiceDeps) {
    this.now = deps.now ?? Date.now;
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
    if (target.bannedUntil === null) return { ok: false, code: "not_banned" };
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

  async configVersion(version: number): Promise<GameConfig | null> {
    const [row] = await this.deps.db.select({ data: gameConfig.data }).from(gameConfig).where(eq(gameConfig.version, version)).limit(1);
    return row ? (row.data as GameConfig) : null;
  }

  async saveConfig(admin: SessionUser, input: { baseVersion: number; config: unknown; comment: string }): Promise<ConfigAnswer> {
    return this.applyParsed(admin, input.config, { baseVersion: input.baseVersion, comment: input.comment, action: "config_save" });
  }

  async rollbackConfig(admin: SessionUser, input: { version: number; baseVersion: number; comment: string }): Promise<ConfigAnswer> {
    const old = await this.configVersion(input.version);
    if (old === null) return { ok: false, code: "not_found" };
    return this.applyParsed(admin, old, {
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
      const issues: ConfigIssue[] = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return Promise.resolve({ ok: false, code: "invalid", issues });
    }
    // The engine keeps the parsed object as the live config, so it must not be shared with anything else.
    return this.deps.runtime.run((engine, now) => engine.applyConfig(parsed.data, { ...change, adminId: admin.id }, now));
  }

  /** Persists a ban/unban with its log row, then pushes it to the engine and drops cached rankings. */
  private async writeAccess(
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
