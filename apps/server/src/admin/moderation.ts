import { MAX_AREA_CELLS, rectCells, type Rect } from "@rave/shared";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { CellWrite, ModerationMeta, ModerationPlan } from "../engine/types";
import type { GameRuntime } from "../persistence/runtime";

export type ModerationAction =
  | { kind: "rollback_player"; userId: number; from: number; to: number; area: Rect | null; removeBombs: boolean }
  | { kind: "clear_area"; area: Rect; mode: "fill" }
  | { kind: "clear_area"; area: Rect; mode: "to_time"; at: number }
  | { kind: "remove_bombs"; userId: number }
  | { kind: "remove_bombs"; area: Rect };

export type PlanError = "bad_area" | "area_too_large" | "bad_period" | "not_found";

export interface PlannedAction {
  plan: ModerationPlan;
  meta: Omit<ModerationMeta, "adminId">;
  /** Bounding box of the planned writes and bombs, or null when nothing would change. */
  bbox: Rect | null;
}

export type PlanResult = { ok: true; planned: PlannedAction } | { ok: false; code: PlanError };

/** How far in the future a period may end (clock skew between admin and server). */
const FUTURE_SLACK_MS = 60_000;

/** Checks that the rectangle lies on the canvas and is small enough for one action. */
export function validateArea(r: Rect, canvas: { width: number; height: number }): PlanError | null {
  const coords = [r.x1, r.y1, r.x2, r.y2];
  if (!coords.every(Number.isInteger)) return "bad_area";
  if (r.x1 < 0 || r.y1 < 0 || r.x2 >= canvas.width || r.y2 >= canvas.height) return "bad_area";
  if (r.x1 > r.x2 || r.y1 > r.y2) return "bad_area";
  if (rectCells(r) > MAX_AREA_CELLS) return "area_too_large";
  return null;
}

export function summarize(planned: PlannedAction): { cells: number; bombs: number; bbox: Rect | null } {
  return { cells: planned.plan.writes.length, bombs: planned.plan.bombs.length, bbox: planned.bbox };
}

function boundingBox(cells: Iterable<{ x: number; y: number }>): Rect | null {
  let box: Rect | null = null;
  for (const { x, y } of cells) {
    if (!box) box = { x1: x, y1: y, x2: x, y2: y };
    else box = { x1: Math.min(box.x1, x), y1: Math.min(box.y1, y), x2: Math.max(box.x2, x), y2: Math.max(box.y2, y) };
  }
  return box;
}

const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;
const inArea = (area: Rect | null, alias: string): SQL =>
  area
    ? sql`and ${sql.raw(alias)}.x between ${area.x1} and ${area.x2} and ${sql.raw(alias)}.y between ${area.y1} and ${area.y2}`
    : sql``;

type WriteRow = {
  x: number;
  y: number;
  last_color: number;
  last_user: number;
  color_id: number;
  user_id: number;
};

export interface ModerationPlannerDeps {
  db: Db;
  runtime: GameRuntime;
  now?: () => number;
}

/** Builds moderation plans; the engine applies them later, guarded by each write's `expect`. */
export class ModerationPlanner {
  private readonly now: () => number;

  constructor(private deps: ModerationPlannerDeps) {
    this.now = deps.now ?? Date.now;
  }

  async plan(action: ModerationAction): Promise<PlanResult> {
    const canvas = this.deps.runtime.engine.canvas;
    if ("area" in action && action.area) {
      const bad = validateArea(action.area, canvas);
      if (bad) return { ok: false, code: bad };
    }
    switch (action.kind) {
      case "rollback_player": {
        if (!this.validPeriod(action.from, action.to)) return { ok: false, code: "bad_period" };
        if (!(await this.userExists(action.userId))) return { ok: false, code: "not_found" };
        return { ok: true, planned: await this.rollbackPlayer(action) };
      }
      case "clear_area": {
        if (action.mode === "fill") return { ok: true, planned: this.clearFill(action.area) };
        if (!this.validPeriod(action.at, action.at)) return { ok: false, code: "bad_period" };
        return { ok: true, planned: await this.clearToTime(action.area, action.at) };
      }
      case "remove_bombs": {
        if ("userId" in action) {
          if (!(await this.userExists(action.userId))) return { ok: false, code: "not_found" };
          return { ok: true, planned: this.removeBombs(this.bombCells(this.deps.runtime.engine.bombs.ownedBy(action.userId)), action.userId, { userId: action.userId }) };
        }
        return { ok: true, planned: this.removeBombs(this.bombCells(this.deps.runtime.engine.bombs.inRect(action.area)), null, { area: action.area }) };
      }
    }
  }

  private validPeriod(from: number, to: number): boolean {
    return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to <= this.now() + FUTURE_SLACK_MS;
  }

  private async userExists(userId: number): Promise<boolean> {
    if (!Number.isInteger(userId)) return false;
    const [row] = await this.deps.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return row !== undefined;
  }

  private bombCells(bombs: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    return bombs.map(({ x, y }) => ({ x, y }));
  }

  private planned(kind: ModerationPlan["kind"], writes: CellWrite[], bombs: ModerationPlan["bombs"], meta: PlannedAction["meta"]): PlannedAction {
    return { plan: { kind, writes, bombs }, meta, bbox: boundingBox([...writes, ...bombs]) };
  }

  /**
   * Cells whose latest event is the target's placement within the period. Each returns to the
   * latest event that is not such a placement (another player's pixel, the target's older pixel,
   * or an empty cell).
   */
  private async rollbackPlayer(action: Extract<ModerationAction, { kind: "rollback_player" }>): Promise<PlannedAction> {
    const { userId: target, from, to, area, removeBombs } = action;
    const season = this.deps.runtime.season;
    const rows = await this.deps.db.execute<WriteRow>(sql`
      with cells as (
        select distinct x, y from pixel_events p
        where p.season_id = ${season} and p.user_id = ${target} and p.kind = 'place'
          and p.created_at between ${ts(from)} and ${ts(to)}
          ${inArea(area, "p")}
      ),
      last as (
        select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id, e.kind, e.created_at
        from pixel_events e join cells c on c.x = e.x and c.y = e.y
        where e.season_id = ${season}
        order by e.x, e.y, e.id desc
      ),
      restore as (
        select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id
        from pixel_events e join cells c on c.x = e.x and c.y = e.y
        where e.season_id = ${season}
          and not (e.user_id is not distinct from ${target} and e.kind = 'place' and e.created_at between ${ts(from)} and ${ts(to)})
        order by e.x, e.y, e.id desc
      )
      select l.x, l.y, l.color_id as last_color, l.user_id as last_user,
        coalesce(r.color_id, 0) as color_id, coalesce(r.user_id, 0) as user_id
      from last l left join restore r on r.x = l.x and r.y = l.y
      where l.user_id = ${target} and l.kind = 'place' and l.created_at between ${ts(from)} and ${ts(to)}
      order by l.y, l.x
    `);
    const writes = rows.map((r) => this.write(r));
    let bombs: ModerationPlan["bombs"] = [];
    if (removeBombs) {
      const store = this.deps.runtime.engine.bombs;
      bombs = this.bombCells(area ? store.inRect(area).filter((b) => b.ownerId === target) : store.ownedBy(target));
    }
    return this.planned("mod_rollback", writes, bombs, {
      action: "rollback_player",
      targetUserId: target,
      params: { from, to, area, removeBombs },
    });
  }

  /** Every non-empty cell of the area becomes empty and ownerless. */
  private clearFill(area: Rect): PlannedAction {
    const canvas = this.deps.runtime.engine.canvas;
    const writes: CellWrite[] = [];
    for (let y = area.y1; y <= area.y2; y++) {
      for (let x = area.x1; x <= area.x2; x++) {
        const cell = canvas.get(x, y);
        if (cell.colorId === 0 && cell.ownerId === 0) continue;
        writes.push({ x, y, expect: { colorId: cell.colorId, ownerId: cell.ownerId }, colorId: 0, ownerId: 0 });
      }
    }
    return this.planned("mod_clear", writes, [], { action: "clear_area", targetUserId: null, params: { area, mode: "fill" } });
  }

  /** Cells of the area changed after `at` return to their state at `at` (empty if none). */
  private async clearToTime(area: Rect, at: number): Promise<PlannedAction> {
    const season = this.deps.runtime.season;
    const rows = await this.deps.db.execute<WriteRow>(sql`
      with cells as (
        select distinct x, y from pixel_events p
        where p.season_id = ${season} and p.created_at > ${ts(at)}
          ${inArea(area, "p")}
      ),
      last as (
        select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id
        from pixel_events e join cells c on c.x = e.x and c.y = e.y
        where e.season_id = ${season}
        order by e.x, e.y, e.id desc
      ),
      restore as (
        select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id
        from pixel_events e join cells c on c.x = e.x and c.y = e.y
        where e.season_id = ${season} and e.created_at <= ${ts(at)}
        order by e.x, e.y, e.id desc
      )
      select l.x, l.y, l.color_id as last_color, coalesce(l.user_id, 0) as last_user,
        coalesce(r.color_id, 0) as color_id, coalesce(r.user_id, 0) as user_id
      from last l left join restore r on r.x = l.x and r.y = l.y
      order by l.y, l.x
    `);
    const writes = rows
      .map((r) => this.write(r))
      .filter((w) => w.expect.colorId !== w.colorId || w.expect.ownerId !== w.ownerId);
    return this.planned("mod_rollback", writes, [], { action: "clear_area", targetUserId: null, params: { area, mode: "to_time", at } });
  }

  private removeBombs(bombs: ModerationPlan["bombs"], targetUserId: number | null, params: Record<string, unknown>): PlannedAction {
    return this.planned("mod_clear", [], bombs, { action: "remove_bombs", targetUserId, params });
  }

  private write(r: WriteRow): CellWrite {
    return {
      x: Number(r.x),
      y: Number(r.y),
      expect: { colorId: Number(r.last_color), ownerId: Number(r.last_user) },
      colorId: Number(r.color_id),
      ownerId: Number(r.user_id),
    };
  }
}
