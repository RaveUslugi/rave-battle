# План 5b: модерация холста — откат игрока, очистка области, снятие бомб, инспектор + хвосты 5a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** инструменты модерации холста из раздела 5 спеки:
- откат пикселей игрока за период, по всему холсту или в области, с восстановлением прежних клеток;
- очистка области: заливка фоном или откат к моменту времени;
- снятие бомб игрока или всех бомб в области;
- инспектор клетки: автор, история, бомба.

Всё проходит через `GameEngine`, пишется в `mod_log` и показывается с предпросмотром. Плюс хвосты из финального ревью 5a.

**Architecture:**
- **Сервер, расчёт плана.** Новый модуль `apps/server/src/admin/moderation.ts` (`ModerationPlanner`) по запросу строит план действия:
  - список записей клеток `{x, y, expect, colorId, ownerId}`, где `expect` — состояние клетки, которое мы ожидаем увидеть на момент применения;
  - список бомб к снятию.

  История берётся из `pixel_events` (индекс `(season_id, x, y, id)`), текущее состояние и бомбы — из движка.
- **Сервер, применение.** `engine.applyModeration(plan, meta, now)` — синхронный шаг единственного писателя.
  - Клетка записывается, только если её текущее `(colorId, ownerId)` совпадает с `expect`. Пиксели, поставленные после предпросмотра или расчёта, не трогаются, а считаются как «пропущено».
  - Эмитятся события `pixel` с `kind` (`mod_rollback` или `mod_clear`), `bomb_removed` с `reason: "moderated"` и `mod_log`.
  - Всё это пишется group commit'ом одной транзакцией. Hub рассылает обычные дельты чанков; лента модерацию не показывает.
- **API.** `admin.moderation.preview(action)` и `admin.moderation.apply(action)` вычисляют план на сервере одинаково. Клиент присылает только описание действия, никогда не готовые записи. `admin.canvas.inspect({x, y})`.
- **Клиент.** Для админа рядом с палитрой появляются два инструмента:
  - 🔎 «Инспектор» — клик или тап по клетке;
  - ▭ «Область» — мышью тянуть прямоугольник, на тач-экране два тапа по углам.

  Результат показывается в новой вкладке боковой панели «Модерация» (только для админа). Там инспектор, координаты области (редактируемые), предпросмотр и кнопки действий. Откат игрока по всему холсту запускается из карточки игрока в `/admin`.

**Tech Stack:** Bun 1.3.6, drizzle 0.45.3 + postgres.js, tRPC 11.19.0, React 19.3, TanStack Query 5, zustand 5, PixiJS 8, bun test.

---

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Наложения при откате | Откатываются только клетки, которые сейчас принадлежат цели **и** последнее событие которых — её пиксель (`place`) из периода. Клетка возвращается в последнее состояние, которое не является пикселем цели из периода: чужой пиксель, старый пиксель цели или пусто (0, без владельца). Чужие более поздние пиксели не трогаются |
| Статистика и монеты | Откат меняет только холст; территория пересчитывается сама. Счётчики, монеты и рейтинги не меняются |
| Бомбы при откате | Чекбокс «Также снять все бомбы игрока» (включён по умолчанию) |
| Выбор области | В игре: мышью тянуть прямоугольник, на тач-экране два тапа по углам; координаты можно поправить вручную |
| Инспектор | Инструмент админа в игре: клик по клетке открывает вкладку «Модерация» с автором, последними 20 событиями клетки и бомбой (владелец, с какого времени) |
| Очистка области | Два режима: «Залить фоном» (цвет 0, без владельца) и «Откатить к моменту» (каждая клетка — в состояние на время T). Не больше 65 536 клеток за действие (например, 256×256) |
| Снятие бомб | Тихо и без возврата: `reason = moderated`, `removed_by = админ`, без записи в ленте |
| Предпросмотр | Сервер считает план «вхолостую»: сколько клеток изменится, сколько бомб снимется, рамка. Админ подтверждает. При применении план считается заново, клетки, изменившиеся после расчёта, пропускаются |
| Период отката игрока | Пресеты 1 ч / 24 ч / 7 д / всё время или своё «с — по». Область: весь холст (из карточки в `/admin`) или выбранная область (из игры) |
| Видимость для игроков | Никакой: холст просто меняется обычными дельтами |
| Хвосты 5a | Гонки бана; `MOD_ACTIONS` в `@rave/shared`; валидация старых версий конфига; полировка админки и недостающие тесты |

Дополнительные решения, которые я принял сам (можно оспорить):
- **Без лимита для отката игрока по всему холсту.** Объём ограничен его же территорией. Лимит 65 536 клеток действует только на действия «в области».
- **Откат игрока в области — из списка авторов.** Вкладка «Модерация» показывает авторов пикселей в выбранной области с числом клеток: движок сканирует не больше 65 536 клеток. Админ выбирает игрока из этого списка.
- **Очистка не снимает бомбы.** Для бомб есть отдельная кнопка «Снять бомбы в области» в той же вкладке.
- **Новые действия журнала:** `rollback_player`, `clear_area`, `remove_bombs`. В `params` пишутся область, период или режим и счётчики (`cells`, `skipped`, `bombs`).
- **Бомба на откатываемой клетке без галочки «снять бомбы» остаётся.** Она невидима, как и любая бомба.

```
 game (admin): 🔎 / ▭ tool ─► ui-store.moderation {cell | area} ─► SidePanel «Модерация»
                                                                    │ tRPC (admin.*)
 /admin PlayerCard: «Откатить пиксели» ─────────────────────────────┤
                                                                    ▼
 admin.canvas.inspect ─► canvas.get + bombs.get + pixel_events (last 20 for x,y)
 admin.moderation.preview/apply(action)
     └─► ModerationPlanner.plan(action)
           rollback_player: SQL over pixel_events (cells, last event, restore point)
           clear_area fill: engine canvas scan of the rect
           clear_area to_time: SQL (cells changed after T, state at T)
           remove_bombs: engine bombs (by owner / in rect)
     preview → counts + bbox
     apply  → runtime.run(engine.applyModeration(plan))
                ├─ cell writes guarded by `expect` → pixel{kind} events
                ├─ bombs → bomb_removed{reason:"moderated"}
                └─ mod_log
              → group commit (one tx) → Hub: chunk deltas only (feed skips moderated)
```

## Файлы

Сервер и общие:
- Create `packages/shared/src/admin.ts`: `MOD_ACTIONS`, `ModAction`, тип `Rect`, `MAX_AREA_CELLS`. Экспорт из `index.ts` и `client.ts`.
- Modify `apps/server/src/engine/types.ts`, `engine.ts`, `bomb-store.ts` (+tests).
- Create `apps/server/src/engine/engine.moderation.test.ts`.
- Modify `apps/server/src/persistence/write-batch.ts` (+test).
- Modify `apps/server/src/net/views.ts` (+test): лента пропускает `moderated`.
- Create `apps/server/src/admin/moderation.ts`, `moderation.test.ts`.
- Modify `apps/server/src/admin/service.ts` (+test), `apps/server/src/trpc/router.ts` (+test), `apps/server/src/trpc/init.ts`, `apps/server/src/net/hub.ts`.
- Create `apps/server/src/auth/ensure-player.ts` (+test).

Клиент:
- Modify `apps/web/src/state/ui-store.ts` (+test), `apps/web/src/game/client.ts` (+test), `apps/web/src/canvas/session.ts`, `pixi-renderer.ts`.
- Create `apps/web/src/game/area.ts` (+test).
- Modify `apps/web/src/ui/PaletteBar.tsx`, `SidePanel.tsx`, `PanelMenu.tsx`.
- Create `apps/web/src/ui/ModerationTab.tsx`, `apps/web/src/ui/moderation-format.ts` (+test).
- Modify `apps/web/src/admin/*` (PlayerCard, labels, ModLogSection, ConfigHistory, ConfigSection, config-draft, AdminApp, admin.module.css), `apps/web/src/canvas/session.ts` (тест ветки `config`).
- Modify `docs/superpowers/plans/2026-10-07-00-roadmap.md`.

Проверки из корня: `bun test` (Postgres: `bun run db:up`), `bun run typecheck`, `bun run build:web`.

---

### Task 1: Общие типы модерации в `@rave/shared`

**Files:** Create `packages/shared/src/admin.ts`; Modify `packages/shared/src/index.ts`, `client.ts`, `apps/server/src/engine/types.ts`, `apps/web/src/admin/labels.ts`, `ModLogSection.tsx`

- [ ] **Step 1:** `packages/shared/src/admin.ts`:
  ```ts
  /** Moderation log actions. Shared so the admin UI never imports server source. */
  export const MOD_ACTIONS = ["ban", "unban", "player_edit", "config_save", "config_rollback", "rollback_player", "clear_area", "remove_bombs"] as const;
  export type ModAction = (typeof MOD_ACTIONS)[number];

  /** Inclusive canvas rectangle. */
  export interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  /** Largest area one moderation action may touch (e.g. 256×256). */
  export const MAX_AREA_CELLS = 65_536;

  export const rectCells = (r: Rect) => (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1);

  /** Corner order does not matter: returns x1 ≤ x2, y1 ≤ y2. */
  export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }
  ```
  Экспортируй этот модуль из `index.ts` и `client.ts` (zod в нём нет). Добавь тест на `normalizeRect` и `rectCells` в новый `packages/shared/src/admin.test.ts`.

- [ ] **Step 2:**
  - `engine/types.ts`: удали локальные `MOD_ACTIONS`/`ModAction` и реэкспортируй их из `@rave/shared`, чтобы импорты сервера не менялись.
  - `apps/web/src/admin/labels.ts` и `ModLogSection.tsx`: импортируй `ModAction` и `MOD_ACTIONS` из `@rave/shared/client`, импорт `../../../server/...` убери.
  - В `ACTION_LABEL` добавь `rollback_player` «Откат игрока», `clear_area` «Очистка области», `remove_bombs` «Снятие бомб». Деталь этих записей в журнале — Task 12.

- [ ] **Step 3:** `bun test packages && bun run typecheck` → PASS. Проверь, что в `apps/web/src` больше нет `server/src`: `grep -rn "server/src" apps/web/src` выдаёт только `net/trpc.ts` (тип `AppRouter`). Commit: `refactor: moderation actions and rect helpers in @rave/shared`.

---

### Task 2: Движок — `applyModeration`, бомбы по владельцу и в области, `kind` у пикселей

**Files:** Modify `apps/server/src/engine/types.ts`, `engine.ts`, `bomb-store.ts`, `bomb-store.test.ts`, `canvas-store.ts`; Create `apps/server/src/engine/engine.moderation.test.ts`

- [ ] **Step 1: Типы.**
  ```ts
  export type PixelKind = "place" | "mod_rollback" | "mod_clear";
  // EngineEvent "pixel": add `kind: PixelKind` (placePixel emits "place").
  // EngineEvent "bomb_removed": reason: "exploded" | "defused" | "moderated".

  export interface CellWrite {
    x: number;
    y: number;
    /** State the planner saw; the write is skipped if the cell differs now. */
    expect: { colorId: number; ownerId: UserId };
    colorId: number;
    ownerId: UserId;
  }

  export interface ModerationPlan {
    kind: Exclude<PixelKind, "place">;
    writes: CellWrite[];
    /** Cells whose active bomb is removed (if one is still there). */
    bombs: Array<{ x: number; y: number }>;
  }

  export interface ModerationMeta {
    adminId: UserId;
    action: "rollback_player" | "clear_area" | "remove_bombs";
    targetUserId: UserId | null;
    params: Record<string, unknown>;
  }

  export type ModerationResult = { ok: true; cells: number; skipped: number; bombs: number };
  ```
  Найди все места, где создаются события `pixel` (тесты, `views.test.ts`, `write-batch.test.ts`, `hub`), и добавь им `kind: "place"`.

- [ ] **Step 2: `BombStore`.**
  - `ownedBy(ownerId): Bomb[]` и `inRect(r: Rect): Bomb[]`. Обход — по `byCell.values()`; число бомб невелико: лимит активных на игрока × число игроков.
  - Тест: три бомбы двух владельцев; оба метода возвращают нужные; граница прямоугольника включительна.

- [ ] **Step 3: Тест `engine.moderation.test.ts`.**
  1. **Запись по `expect`.** Клетка `(5,5)`, на ней пиксель игрока 2 цвета 7. План с записью `expect {7, 2} → {0, 0}` применяется:
     - `cells: 1`, клетка стала `0/0`, `territoryOf(2) === 0`;
     - событие `pixel` с `kind: "mod_rollback"`, `prevColorId: 7`, `prevUserId: 2`, `userId: 0`.
  2. **Пропуск.** `expect` не совпадает (после плана игрок 3 перекрасил клетку) → `skipped: 1`, клетка не тронута, событий `pixel` нет.
  3. **Бомбы.** Две бомбы игрока 2 → `bombs: 2`. События `bomb_removed` с `reason: "moderated"`, `removedBy: adminId`; `bombs.activeCount(2) === 0`. Клетка без бомбы в списке молча пропускается.
  4. **`mod_log`.** Ровно одна запись: `action`, `targetUserId`, а `params` = переданные `params` + `{ cells, skipped, bombs }`.
  5. **Пустой результат** (всё пропущено, бомб нет) тоже пишет `mod_log`: попытка модерации видна в журнале.

- [ ] **Step 4: Реализация.**
  ```ts
  /** Moderator canvas edit: guarded cell writes, bomb removal and one mod_log entry. Stats and coins are untouched. */
  applyModeration(plan: ModerationPlan, meta: ModerationMeta, now: number): ModerationResult {
    let cells = 0;
    let skipped = 0;
    for (const w of plan.writes) {
      const current = this.canvas.get(w.x, w.y);
      if (!this.canvas.inBounds(w.x, w.y) || current.colorId !== w.expect.colorId || current.ownerId !== w.expect.ownerId) {
        skipped++;
        continue;
      }
      if (current.colorId === w.colorId && current.ownerId === w.ownerId) continue;
      const prev = this.canvas.set(w.x, w.y, w.colorId, w.ownerId);
      this.emit({ type: "pixel", kind: plan.kind, x: w.x, y: w.y, userId: w.ownerId, colorId: w.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
      cells++;
    }
    let bombs = 0;
    for (const { x, y } of plan.bombs) {
      const bomb = this.bombs.remove(x, y);
      if (!bomb) continue;
      this.emit({ type: "bomb_removed", x, y, ownerId: bomb.ownerId, reason: "moderated", removedBy: meta.adminId, at: now });
      bombs++;
    }
    this.emit({ type: "mod_log", adminId: meta.adminId, action: meta.action, targetUserId: meta.targetUserId, params: { ...meta.params, cells, skipped, bombs }, at: now });
    return { ok: true, cells, skipped, bombs };
  }
  ```

- [ ] **Step 5:** `bun test apps/server && bun run typecheck` → PASS. Commit: `feat(server): guarded moderation writes and bomb removal in the engine`.

---

### Task 3: Запись и рассылка модерации

**Files:** Modify `apps/server/src/persistence/write-batch.ts`, `write-batch.test.ts`, `restart.test.ts`, `apps/server/src/net/views.ts`, `views.test.ts`, `server.test.ts`

- [ ] **Step 1: Запись.**
  - `insertPixels` пишет `kind: e.kind` вместо константы `"place"`.
  - `applyBombEvents` уже пишет `e.reason`; тип расширен в Task 2.
  - Тест `write-batch.test.ts`: событие `pixel` с `kind: "mod_clear"` и `userId: 0` даёт строку с `kind = mod_clear`, `user_id = null`. `bomb_removed` с причиной `moderated` даёт `removed_reason = moderated` и `removed_by = admin`.

- [ ] **Step 2: Восстановление.** Тест в `restart.test.ts`:
  1. игрок ставит пиксель;
  2. `applyModeration` затирает его в `0/0`;
  3. `runtime.stop()` и новый `bootGame`;
  4. клетка `0/0`, `territoryOf(player) === 0`.

  Реплей `loadCanvas` применяет все события подряд, независимо от `kind`.

- [ ] **Step 3: Лента и дельты.**
  - `buildFeed` берёт только `reason === "exploded" || reason === "defused"`; `moderated` в ленту не попадает.
  - Тест в `views.test.ts`: `moderated` не даёт записи ленты.
  - Тест в `server.test.ts`: после `runtime.run(e => e.applyModeration(...))` подписчик чанка получает бинарную дельту с новым цветом, а записи `feed` нет.

- [ ] **Step 4:** `bun test apps/server` → PASS. Commit: `feat(server): persist and broadcast moderation edits without feed entries`.

---

### Task 4: `ModerationPlanner` — расчёт планов

**Files:** Create `apps/server/src/admin/moderation.ts`, `moderation.test.ts`

- [ ] **Step 1: Действия и валидация.**
  ```ts
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
  ```
  `validateArea(r, canvas)`:
  - `bad_area`, если координаты не целые, вне холста или `x1 > x2` / `y1 > y2`;
  - `area_too_large`, если `rectCells > MAX_AREA_CELLS`.

  Период: `bad_period`, если `from > to` или `to > now + 60_000`. `rollback_player` и `remove_bombs {userId}` проверяют, что пользователь существует в `users` (иначе `not_found`).

- [ ] **Step 2: `rollback_player`** — один SQL-запрос через `db.execute(sql\`...\`)`. Параметры передаются через `${}`, имена колонок те, что в схеме.
  ```sql
  with cells as (
    select distinct x, y from pixel_events
    where season_id = $season and user_id = $target and kind = 'place'
      and created_at between $from and $to
      [and x between $x1 and $x2 and y between $y1 and $y2]
  ),
  last as (
    select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id, e.kind, e.created_at
    from pixel_events e join cells c on c.x = e.x and c.y = e.y
    where e.season_id = $season
    order by e.x, e.y, e.id desc
  ),
  restore as (
    select distinct on (e.x, e.y) e.x, e.y, e.user_id, e.color_id
    from pixel_events e join cells c on c.x = e.x and c.y = e.y
    where e.season_id = $season
      and not (e.user_id = $target and e.kind = 'place' and e.created_at between $from and $to)
    order by e.x, e.y, e.id desc
  )
  select l.x, l.y, l.color_id as last_color, coalesce(r.color_id, 0) as color_id, coalesce(r.user_id, 0) as user_id
  from last l left join restore r on r.x = l.x and r.y = l.y
  where l.user_id = $target and l.kind = 'place' and l.created_at between $from and $to
  ```
  Каждая строка даёт запись `{ x, y, expect: { colorId: last_color, ownerId: target }, colorId, ownerId }`.

  Если `removeBombs`: `bombs` = `engine.bombs.ownedBy(target)`; при заданной `area` — только бомбы внутри неё.

  `meta`: `action: "rollback_player"`, `targetUserId`, `params: { from, to, area, removeBombs }`.

  `kind` плана — `"mod_rollback"`.

- [ ] **Step 3: `clear_area`.**
  - **`fill`:** обойти прямоугольник через `engine.canvas.get`. Для каждой клетки, где `colorId !== 0 || ownerId !== 0`, создать запись `expect = текущее → {0, 0}`. `kind` плана — `"mod_clear"`, `params: { area, mode: "fill" }`.
  - **`to_time`:** такой же SQL, как в Step 2, с другими фильтрами.
    - `cells`: клетки области, у которых есть событие с `created_at > $at`.
    - `last`: последнее событие клетки.
    - `restore`: последнее событие с `created_at <= $at`.
    - Запись: `expect = {last.color_id, coalesce(last.user_id, 0)} → {restore или 0/0}`. Клетки, где `expect` уже равен цели, пропускаются.
    - `kind` плана — `"mod_rollback"`, `params: { area, mode: "to_time", at }`.

- [ ] **Step 4: `remove_bombs`.** Бомбы берутся из движка: `ownedBy(userId)` или `inRect(area)`. Записей клеток нет. `kind` плана — `"mod_clear"` (не используется). `targetUserId` — `userId` или `null`.

- [ ] **Step 5: Сводка.** `summarize(planned)` возвращает `{ cells: writes.length, bombs: bombs.length, bbox }`. В `bbox` входят все записи и бомбы; если плана нет — `null`.

- [ ] **Step 6: Тесты `moderation.test.ts`** (тестовая БД, `bootGame`; пиксели ставятся через `runtime.run(e => e.placePixel(...))` с разным `now`, чтобы был разный `created_at`). Спека 9.4 требует сценарии с наложением пикселей нескольких игроков. Сценарии для клетки `(10,10)`, цель — T, другие — A и B, период — `[t1, t3]`:
  1. A (t0), затем T (t2) → вернуть A.
  2. T (t2), затем A (t4) → клетка не в плане: последнее событие чужое.
  3. A (t0), T (t2), B (t2.5), T (t3) → вернуть B.
  4. T (t0, до периода), затем T (t2) → вернуть старый пиксель T из t0.
  5. T (t2) на пустой клетке → `0/0`.
  6. T (t2), затем T (t5, после периода) → клетка не в плане.
  7. Область: два пикселя T (внутри и вне области) → в плане только тот, что внутри.
  8. Галочка `removeBombs` → в план попадают все бомбы T; с `area` — только бомбы в области.
  9. Применение после чужого пикселя: план посчитан, затем A перекрасил клетку из сценария 1, потом `applyModeration` → `skipped: 1`.

  Тесты очистки:
  - `fill` на 3×3 с двумя непустыми клетками → две записи в `0/0`.
  - `to_time`: пиксели в t0 и t2, `at = t1` → клетка возвращается к состоянию t0; клетка, впервые закрашенная после `at`, становится `0/0`.

  Тесты отказов: `area_too_large` (257×256), `bad_area` (вне холста), `bad_period`.

  Тест `remove_bombs`: по владельцу и по области.

- [ ] **Step 7:** `bun test apps/server/src/admin` → PASS. Commit: `feat(server): moderation planner for player rollback, area clear and bomb removal`.

---

### Task 5: Инспектор и `admin.moderation.*` / `admin.canvas.*` в tRPC

**Files:** Modify `apps/server/src/admin/service.ts`, `service.test.ts`, `apps/server/src/trpc/router.ts`, `router.test.ts`

- [ ] **Step 1: Методы `AdminService`.**
  - `inspect(x, y)`: если клетка вне холста, `null`. Иначе:
    ```ts
    {
      x, y, colorId, owner: UserRef | null,
      bomb: { owner: UserRef; createdAt: number } | null,
      history: Array<{ at: number; user: UserRef | null; colorId: number; prevColorId: number; kind: PixelKind }>,
    }
    ```
    `history` — последние 20 событий клетки по индексу `(season_id, x, y, id)`, `order by id desc`. Это единственное место, где наружу уходят данные о бомбе (спека 8: «админский инспектор»).
  - `previewModeration(action)` возвращает `{ ok: true, cells, bombs, bbox } | { ok: false, code: PlanError }`.
  - `applyModeration(admin, action)`:
    1. посчитать план; при ошибке вернуть `{ok:false, code}`;
    2. `runtime.run((e, now) => e.applyModeration(plan, { ...meta, adminId: admin.id }, now))`;
    3. вернуть `{ ok: true, cells, skipped, bombs }`.

    Применения выполняются по одному: очередь на `Promise` внутри `AdminService`. Без неё два одновременных отката посчитали бы планы по одному и тому же состоянию; guard `expect` всё равно защищает, но очередь делает счётчики понятными.
  - `areaOwners(area)`: авторы пикселей в области с числом клеток, по убыванию, топ-20. Сканирует движок (`validateArea` — тот же). Возвращает `Array<{ user: UserRef; cells: number }>`.

- [ ] **Step 2: Роутер.** Вход описывается zod-схемой `moderationAction`:
  - `z.discriminatedUnion("kind", [...])`;
  - `rect`: `x1..y2` — `z.number().int().nonnegative()`;
  - `from`, `to`, `at` — `z.number().int().nonnegative()`;
  - у `clear_area` поле `mode` — вложенное объединение;
  - `remove_bombs` — `{ kind, userId }` или `{ kind, area }` через `z.union`.

  Процедуры:
  - `admin.canvas.inspect` — query, вход `cell`; если клетки нет, `NOT_FOUND`.
  - `admin.canvas.areaOwners` — query, вход `{ area: rect }`.
  - `admin.moderation.preview` — query, вход `{ action }` (только чтение, GET допустим).
  - `admin.moderation.apply` — mutation, вход `{ action }`.

- [ ] **Step 3: Тесты.**
  - `service.test.ts`:
    - `inspect` отдаёт автора, бомбу с владельцем и историю, новые события первыми, максимум 20;
    - `preview` и `apply` для отката игрока: превью показывает `cells: 1`, применение — `cells: 1, skipped: 0`;
    - в `mod_log` `params` содержит счётчики;
    - `areaOwners` сортирует по числу клеток.
  - `router.test.ts`:
    - alice получает FORBIDDEN на `admin.canvas.inspect` и `admin.moderation.apply`;
    - область 257×256 → `{ ok: false, code: "area_too_large" }`.

- [ ] **Step 4:** `bun test apps/server && bun run typecheck` → PASS. Commit: `feat(server): cell inspector, area owners and moderation preview/apply procedures`.

---

### Task 6: Хвосты 5a на сервере — гонки бана, старые версии конфига

**Files:** Create `apps/server/src/auth/ensure-player.ts`, `ensure-player.test.ts`; Modify `apps/server/src/trpc/init.ts`, `apps/server/src/net/hub.ts`, `apps/server/src/admin/service.ts`, `service.test.ts`, `apps/server/src/persistence/runtime.ts`

- [ ] **Step 1: Гонка бана и первого входа.**
  - `runtime.addPlayer` возвращает `{ player, created: boolean }`. Обнови вызовы.
  - Новый `ensurePlayer(deps, user)`:
    1. вызывает `addPlayer` с полями из `SessionUser`;
    2. если `created`, перечитывает из `users` `banned_until`, `ban_reason` и `guild_member`;
    3. если перечитанное отличается от того, что применено, вызывает `runtime.run(e => e.setAccess(...))`.

    Так бан, закоммиченный между `resolveSession` и `addPlayer`, не теряется. Если же бан закоммичен после перечитывания, `AdminService.writeAccess` увидит игрока в движке и применит бан сам.
  - `playerProcedure` и `Hub.open` используют `ensurePlayer`.
  - Тест: «сессия разрешена до бана, бан записан в БД без движка (как в гонке), затем `ensurePlayer`» → игрок забанен с причиной.

- [ ] **Step 2: Бан и разбан двух админов.**
  - `writeAccess` выполняется последовательно для каждого пользователя: `Map<userId, Promise<void>>`, цепочка, ключ удаляется после завершения.
  - Тест: параллельные `ban` и `unban` одного игрока (`Promise.all`) — после обоих бан в БД и в движке совпадает.

- [ ] **Step 3: Разбан истёкшего бана.**
  - `unban` возвращает `not_banned`, если `banned_until` равен `null` или `<= now`.
  - Тест: бан, истёкший минуту назад → `not_banned`.

- [ ] **Step 4: Старые версии конфига.**
  - `configVersion(version)` возвращает `{ ok: true, config } | { ok: false, code: "not_found" } | { ok: false, code: "invalid", issues }` через `gameConfigSchema.safeParse`.
  - `admin.config.get` отдаёт этот ответ как есть, а `rollbackConfig` использует тот же путь.
  - Тесты:
    - вставить в `game_config` версию с `data`, у которого нет `palette` → `get` даёт `invalid`, `rollback` даёт `invalid`;
    - поиск с `\` в запросе (`a\b`) не падает и ищет буквально.

- [ ] **Step 5:** `bun test apps/server && bun run typecheck` → PASS. Commit: `fix(server): close ban races, reject expired unbans, validate old config versions`.

---

### Task 7: Клиент — инструменты админа, выбор области, рамка на холсте

**Files:** Modify `apps/web/src/state/ui-store.ts`, `ui-store.test.ts`, `apps/web/src/game/client.ts`, `client.test.ts`, `apps/web/src/canvas/session.ts`, `pixi-renderer.ts`; Create `apps/web/src/game/area.ts`, `area.test.ts`

- [ ] **Step 1: Состояние в `ui-store`.**
  - `ActiveTool`: `"paint" | Tool | "inspect" | "area"`.
  - `Panel` добавляет `"moderation"`.
  - Новое поле `moderation: { cell: Cell | null; area: Rect | null; corner: Cell | null }`. `corner` — первый тап по углу на тач-экране.
  - Методы:
    - `inspectCell(cell)` ставит `cell`, сбрасывает `area` и открывает панель `"moderation"`;
    - `setArea(rect | null)` ставит `area`, сбрасывает `cell` и `corner` и открывает панель;
    - `setCorner(cell | null)`.
  - Тесты для каждого метода.

- [ ] **Step 2: Чистая логика `game/area.ts`.**
  ```ts
  /** Second tap closes the rectangle; the first one only remembers the corner. */
  export function tapCorner(corner: Cell | null, cell: Cell): { corner: Cell | null; area: Rect | null } {
    if (!corner) return { corner: cell, area: null };
    return { corner: null, area: normalizeRect(corner, cell) };
  }
  ```
  Тесты: первый тап, второй тап, порядок углов не важен, тап в ту же клетку даёт область 1×1.

- [ ] **Step 3: `GameClient.onCellTap`.** Для `ui.tool === "inspect"` вызывает `inspectCell(cell)`. Для `"area"`:
  - касание или перо — `tapCorner`, затем `setCorner` или `setArea`;
  - клик мышью — `setArea(normalizeRect(cell, cell))`, то есть область из одной клетки (для мыши основной путь — протягивание, см. Step 4).

  Права проверяет сервер. Клиент только не показывает эти инструменты не-админам. При смене пользователя `tool` и так сбрасывается на `"paint"`.

  Тесты в `client.test.ts`: оба инструмента вызывают методы стора и не отправляют ничего в сокет.

- [ ] **Step 4: Протягивание мышью в `session.ts`.**
  - В `SessionCallbacks` добавь `areaDrag?(pointerType: string): boolean` (`true`, когда активен инструмент `"area"` и указатель — мышь) и `onAreaDrag?(from: Cell, to: Cell, done: boolean): void`.
  - В `pointermove` при одном указателе, если `areaDrag(tapStart.pointerType)`, камера не двигается. Вместо этого вызывается `onAreaDrag(клетка старта, текущая клетка, false)`. В `release` при `moved` вызывается `onAreaDrag(…, true)`.
  - `App` передаёт `areaDrag: (t) => t === "mouse" && uiStore.getState().tool === "area"` и `onAreaDrag: (a, b, done) => done ? ui.setArea(normalizeRect(a, b)) : session.setArea(normalizeRect(a, b))`. Найди, где `App`/`CanvasView` создаёт сессию и подключает `client.onCellTap`, и добавь рядом.

- [ ] **Step 5: Рамка.**
  - `PixiRenderer.setArea(rect | null)` хранит прямоугольник и перерисовывает оверлей.
  - В `drawOverlay` рамка рисуется пунктиром или линией `SELECTION_BORDER` толщиной 2 вокруг `[x1, x2+1) × [y1, y2+1)` в экранных координатах. Ячейка инспектора — это `setArea` 1×1, той же рамкой.
  - В `CanvasPort` добавь `setArea(rect: Rect | null)`. Подписка в `GameClient.attach` показывает `moderation.area`, иначе `moderation.cell` как 1×1, иначе `corner` как 1×1.

- [ ] **Step 6:** `bun test apps/web && bun run typecheck` → PASS. Commit: `feat(web): admin inspect and area tools with canvas selection frame`.

---

### Task 8: Клиент — кнопки инструментов и вкладка «Модерация»

**Files:** Modify `apps/web/src/ui/PaletteBar.tsx`, `PaletteBar.module.css`, `SidePanel.tsx`, `PanelMenu.tsx`; Create `apps/web/src/ui/ModerationTab.tsx`, `apps/web/src/ui/moderation-format.ts`, `moderation-format.test.ts`

- [ ] **Step 1: `PaletteBar`.** Если `gameStore.admin`, после 🧯 добавь две кнопки:
  - «🔎» с `aria-label="Инспектор клетки"`;
  - «▭» с `aria-label="Выделить область"`.

  Повторный клик выключает инструмент (`setTool("paint")`), как у детектора. У активной кнопки `aria-pressed`.

- [ ] **Step 2: `SidePanel` и `PanelMenu`.**
  - В `TABS` добавь `{ panel: "moderation", title: "Модерация", needsLogin: true }`. Вкладка видна только админу: в `SidePanel` фильтруй её по `admin`; в `PanelMenu` пункт не добавляется — вкладку открывают инструменты.
  - Если админ вышел, вкладка закрывается вместе со «своими».

- [ ] **Step 3: `moderation-format.ts` (чистые функции) и тест.**
  - `rectText(r)` → «(10, 20) — (30, 40), 21×21 = 441 клеток»;
  - `kindText(kind)`: «пиксель» / «откат» / «очистка»;
  - `previewText({cells, bombs})`: «Изменится клеток: N · бомб будет снято: M»; при нулях — «Ничего не изменится»;
  - `resultText({cells, skipped, bombs})`: «Готово: клеток N, пропущено K (изменились после расчёта), бомб M»;
  - `PERIOD_PRESETS`: 1 ч / 24 ч / 7 д / «всё время» (`from = 0`).

  Тесты на каждую функцию.

- [ ] **Step 4: `ModerationTab`.**
  - **Если выбрана клетка** — инспектор через `trpc.admin.canvas.inspect`:
    - координаты, образец цвета, автор — ссылка на `/admin?tab=players&player=id`;
    - «💣 Бомба игрока X с {время}» или «Бомбы нет»;
    - список истории: время, автор, цвет «было → стало» образцами, тип.
  - **Если выбрана область:**
    - **Координаты.** Четыре числовых поля (`x1`, `y1`, `x2`, `y2`), их изменение обновляет `ui.setArea`. Под ними `rectText`. Если клеток больше 65 536, предупреждение и все действия неактивны.
    - **«Очистка».** Радио «Залить фоном» / «Откатить к моменту» (`datetime-local`). Кнопка «Посчитать».
    - **«Бомбы».** Кнопка «Посчитать снятие бомб в области».
    - **«Откат игрока в области».** Список `trpc.admin.canvas.areaOwners`: имя и число клеток. Выбор игрока, пресет периода или своё «с — по», чекбокс «Также снять все бомбы игрока в области» (включён), кнопка «Посчитать».
    - **Применение.** «Посчитать» вызывает `trpc.admin.moderation.preview` и показывает `previewText` с кнопками «Применить» и «Отмена». «Применить» вызывает `trpc.admin.moderation.apply` с тем же `action`, а затем показывает `resultText` и инвалидирует `inspect`/`areaOwners`. Ошибки показываются через `adminErrorText`-подобные тексты, они лежат в `moderation-format.ts`: `bad_area` «Область вне холста», `area_too_large` «Слишком большая область», `bad_period` «Неверный период», `not_found` «Игрок не найден». Сетевые ошибки и FORBIDDEN дают «Не удалось выполнить действие».
  - **Если ничего не выбрано** — подсказка «Выберите 🔎 клетку или ▭ область на холсте».

  Вкладка — часть игрового чанка, поэтому импорты только из `@rave/shared/client` (без zod).

- [ ] **Step 5:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS. Проверь, что главный чанк по-прежнему без zod: `grep -l "ZodError\|_zod" apps/web/dist/assets/*.js` находит только `AdminApp-*`. Commit: `feat(web): moderation tab with inspector, area actions and previews`.

---

### Task 9: `/admin` — откат пикселей из карточки игрока

**Files:** Modify `apps/web/src/admin/PlayerCard.tsx`, `admin.module.css`

- [ ] **Step 1:** Новый блок «Откат пикселей» в карточке:
  - пресеты периода из `moderation-format.ts`: `PERIOD_PRESETS`, плюс «Своё» с полями «с» и «по» (`datetime-local`);
  - чекбокс «Также снять все бомбы игрока» (включён);
  - кнопка «Посчитать», затем `previewText`, затем «Применить» / «Отмена».

  Действие: `{ kind: "rollback_player", userId, from, to, area: null, removeBombs }`. Здесь же кнопка «Снять все бомбы игрока»: `remove_bombs {userId}` с тем же предпросмотром.

  После применения инвалидируй `players.get` и `modLog`.

- [ ] **Step 2:** `bun run typecheck && bun run build:web` → PASS. Commit: `feat(web): player pixel rollback and bomb removal from the admin card`.

---

### Task 10: Полировка админки (хвосты 5a)

**Files:** Modify `apps/web/src/admin/AdminApp.tsx`, `PlayerCard.tsx`, `ModLogSection.tsx`, `config-draft.ts`, `config-draft.test.ts`, `ConfigHistory.tsx`, `admin.module.css`

- [ ] **Step 1: Правки по одной строке каждая.**
  1. **`AdminApp`.** Ошибка `whoami` (сеть или сервер) показывает «Не удалось проверить доступ» и кнопку «Повторить» (`refetch`), а не «Нет доступа».
  2. **`PlayerCard`, невалидная дельта.** Поле с невалидной дельтой получает видимую рамку `--neon-pink` (`[aria-invalid="true"]` в CSS) и подпись «целое число, не больше 1 000 000».
  3. **`PlayerCard`, история.** Записи в истории карточки показывают детали `params` той же функцией, что и журнал. Вынеси `details(entry)` из `ModLogSection` в `apps/web/src/admin/log-format.ts` и покрой тестом каждое действие, включая новые `rollback_player` / `clear_area` / `remove_bombs`: «клеток N, пропущено K, бомб M»; для области с `rectText`.
  4. **«до навсегда».** Для постоянного бана в журнале пиши «навсегда: {reason}».
  5. **Фильтр игрока в журнале.** Если не `Number.isSafeInteger` или больше 2 147 483 647, показывается подпись «Неверный id», запрос не уходит.
  6. **Мерцание.** `useInfiniteQuery(..., { placeholderData: keepPreviousData })` в журнале.
  7. **Лишний скролл.** Убери `min-height: 100dvh` из `.page`.
  8. **Неизвестные пути ошибок.** В `config-draft.ts` ошибки с путём не из `SECTIONS` и не `palette` идут в общую группу `general`. Она показывается над кнопкой сохранения. Тест на такой путь.
  9. **Превью отката конфига.** Если `get` ответил `invalid` или `not_found`, показывается «Версия не проходит текущую схему: …» или «Версия не найдена» вместо diff. Ответ сервера теперь `{ok, …}` (Task 6).

- [ ] **Step 2:** `bun test apps/web && bun run typecheck && bun run build:web` → PASS. Commit: `fix(web): admin UI polish from the 5a review`.

---

### Task 11: Недостающие тесты из 5a

**Files:** Modify `apps/server/src/engine/config-change.test.ts`, `apps/web/src/canvas/session.ts` (только если для теста нужна выделенная функция), новый тест рядом

- [ ] **Step 1:** В `config-change.test.ts`:
  - уменьшение высоты → ошибка `canvas.height`;
  - цвет 0 удалить нельзя, даже когда холст пустой: `colorCount(0)` — все клетки. Ожидается ошибка `palette`, если в `next` нет записи с id 0. Схема тоже ловит это, но проверка на холсте должна сработать сама.

- [ ] **Step 2: Ветка `config` в `session.ts`.**
  - Вынеси обработку сообщения `config` в чистую функцию `applyConfigMessage(config, deps: { setConfig, controller, setCanvas, applyCamera })` в `apps/web/src/canvas/config-message.ts`. Пусть `session.ts` её вызывает.
  - Тест: `setConfig`, `controller.onConfig`, `setCanvas` и `applyCamera(true)` вызываются по порядку.

- [ ] **Step 3:** `bun test && bun run typecheck` → PASS. Commit: `test: canvas height shrink, color 0 lock, live config message`.

---

### Task 12: Проверка целиком и roadmap

- [ ] **Step 1:** `bun test`, `bun run typecheck`, `bun run build:web` → PASS. Запиши число тестов.

- [ ] **Step 2: Ручная проверка в браузере.** Нужны админ и dev-игроки `alice` и `bob`.
  1. **Наложения при откате.**
     - alice рисует 5 пикселей.
     - bob перекрашивает один из них.
     - alice рисует ещё 2 пикселя поверх своих старых.
     - Откат alice за последний час из карточки `/admin`: превью показывает `cells`, после применения пиксели alice исчезли, а пиксель bob остался.
     - Там, где alice рисовала поверх своих, восстановилось состояние до периода (пусто).
     - Второе окно (bob) видит изменения без перезагрузки, в ленте ничего нет.
  2. **Бомбы при откате.** Галочка «снять бомбы»: бомбы alice сняты, в профиле alice `activeBombs = 0`.
  3. **Инспектор.** 🔎 по клетке показывает автора, историю (в ней видны записи «откат») и бомбу, если она есть.
  4. **Область мышью.** Протянуть ▭ — рамка видна.
     - «Залить фоном»: превью, применение, область пустая.
     - «Откатить к моменту» (время до шага 1): область вернулась к прежнему состоянию.
     - Область больше 256×256 → предупреждение, кнопки неактивны.
  5. **Откат игрока в области.** Список авторов, выбор bob, превью и применение. Пиксели bob вне области остались.
  6. **Телефон** (375×812): ▭ двумя тапами, вкладка «Модерация» в нижнем листе, кнопки доступны.
  7. **Журнал.** Все действия видны с деталями (клетки, пропущено, бомбы, область, период).
  8. **Перезапуск сервера.** Очищенная область осталась пустой.
  9. **Хвосты.**
     - разбан истёкшего бана → «Игрок не заблокирован»;
     - неверный фильтр в журнале → подсказка;
     - невалидная дельта подсвечена;
     - в истории карточки видны детали.

  Если проверка испортила dev-холст, перед ней сделай `pg_dump` или откати изменения рабочими инструментами 5b.

- [ ] **Step 3: roadmap.**
  - Строку «5b» отметь как выполненную, описав результат.
  - В «Заметках для Плана 5b / 6» отметь закрытые пункты « — закрыто в 5b».
  - Добавь раздел «Заметки для Плана 6 (из финального ревью Плана 5b)».

  Commit: `docs: update the roadmap after plan 5b`.

---

## Самопроверка плана

- **Покрытие решений.** Каждая строка таблицы закрыта задачами:
  - наложения — 4 (сценарии 1–6, 9);
  - статистика — 2: `applyModeration` не трогает статистику и монеты;
  - бомбы при откате — 4 и 8/9;
  - область — 7 и 8;
  - инспектор — 5 и 8;
  - очистка и лимит — 4 и 8;
  - тихое снятие бомб — 2 и 3;
  - предпросмотр — 5, 8 и 9;
  - период — 8 и 9;
  - невидимость для игроков — 3;
  - хвосты — 1, 6, 10 и 11.
- **Согласованность типов.**
  - `PixelKind`, `CellWrite`, `ModerationPlan`, `ModerationMeta` — Task 2, используются в 3 и 4.
  - `ModerationAction` и `PlanError` — Task 4, используются в 5 и 8.
  - `Rect`, `MAX_AREA_CELLS` и `normalizeRect` — Task 1, используются в 4, 7 и 8.
  - Ответ `config.get` меняется в Task 6, клиент подстраивается в Task 10, Step 1.9.
- **Безопасность.**
  - Все новые процедуры — `adminProcedure`.
  - Координаты бомб уходят только в `admin.canvas.inspect` (исключение по спеке 8) и не попадают в превью: там только количество и рамка.
  - Лента не показывает `moderated`.
  - План считается на сервере; клиент не может прислать записи клеток.
- **Атомарность и гонки.**
  - Записи защищены `expect` и применяются одним синхронным шагом движка с одним коммитом.
  - Пиксели, поставленные между расчётом и применением, не затираются.
  - Применения модерации идут через очередь.
- **Производительность.**
  - Область не больше 65 536 клеток: скан движка — миллисекунды.
  - SQL отката опирается на индексы `(season_id, user_id, created_at)` и `(season_id, x, y, id)`.
  - Вставки режутся по 1000 строк, как и сейчас.
- **Вне скоупа:** отмена самой модерации (её можно откатить «к моменту» той же областью); уведомления игрокам; доверенный `X-Forwarded-For`, SPA fallback и версия протокола (План 6).
