# План 8: сервер — основа v1.1, чат, дашборд — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** серверная часть спек v1.1 и ревизии интерфейса. Текущий клиент продолжает работать после каждой части (минимальные правки в нём — только чтобы не сломать совместимость). Новый интерфейс — следующие планы.

Спеки: `2026-10-15-rave-battle-v1.1-design.md` (разделы 3.2, 4.1, 7), `2026-10-15-rave-battle-ui-redesign.md` (разделы 5, 6.2, 6.3, 7).

**Уточнения к спекам, принятые в этом плане:**

- Название цвета — поле `name?: { ru: string; en: string }` в записи палитры (а не ключ i18n): админ задаёт его в конфиге, словари клиента не меняются при каждом новом цвете. Спека ревизии, 3.4 и 6.5, поправлена.
- «Отклонено по возрасту» на дашборде считается из `users`: зарегистрированные за период, у которых на момент регистрации аккаунт Discord был младше `access.minAccountAgeDays`.
- «Последний бэкап» с дашборда убран: бэкапы делает отдельный контейнер, сервер о них не знает.

## 8a. Основа v1.1

### Конфиг

- [ ] `packages/shared/src/config/schema.ts`:
  - запись палитры — `z.discriminatedUnion("type", …)`: `solid` (`params: {}`), `animated` (`frames: hex[2..8]`, `periodMs: 400..10000`), `gradient` (`stops: hex[2..6]`, `scale: 4..256`, `angle: 0..359`, `speed: 0..1`); общие поля `id`, `base`, `unlock`, `price?`, `name?`;
  - новая секция `chat` с `.default(...)`: `enabled` (true), `maxLength` (200, 1..500), `cooldownMs` (3000), `historySize` (100, 10..500), `retentionDays` (30, 1..365). Старые версии конфига без секции проходят схему;
  - кастомные проверки получают код: `ctx.addIssue({ ..., params: { code: "duplicate_palette_id", id } })` и т. п. (`shop_color_needs_price`, `base_color_missing`, `unknown_timezone`).
- [ ] Тип `ConfigIssue = { path: string; code: string; params?: Record<string, unknown> }` в `@rave/shared`. Сервер строит его из zod-ошибок (`custom` → `params.code`, иначе `zod_<code>` с `minimum`/`maximum`/`expected`) и из `configChangeIssues` (`canvas_shrink {current}`, `color_in_use_removed {id, used}`, `color_in_use_type_changed {id}`). Русские строки с сервера уходят.
- [ ] `config:defaults`: 8 эффектных цветов (40–47, `unlock: "shop"`), названия у платных цветов 32–47.
- [ ] Клиент (минимально): `config-draft.ts` — функция `issueText(issue)` с русскими текстами по кодам и запасным «Некорректное значение»; секция `chat` в списке секций редактора.
- [ ] Тесты: схема (старая версия без `chat` проходит, эффекты по типам, коды кастомных проверок), `configChangeIssues` с кодами, `issueText` покрывает все коды.

### Язык игрока

- [ ] Миграция: `users.locale text null` (выбор игрока), `users.discord_locale text null` (обновляется при каждом входе через Discord).
- [ ] `auth/discord.ts`: читать `locale` из `/users/@me`, сохранять в `discord_locale`.
- [ ] `me` возвращает `locale: "ru" | "en" | null` = выбор игрока, иначе язык Discord (`ru*` → `ru`, `en*` → `en`, остальное → `null`).
- [ ] `settings.setLocale({ locale: "ru" | "en" | null })` — мутация для вошедшего (`me` — запрос, в него мутацию не вложить).
- [ ] Тесты: маппинг языка Discord, приоритет, мутация.

### Метрики

- [ ] `net/metrics.ts`: счётчики и гистограммы без зависимостей, вывод в формате Prometheus.
- [ ] Инструменты: сокеты и игроки онлайн, действия по типам (`place`, `detect`, `defuse`, `buy`, `daily`), отказы по кодам, разрывы по лимиту, длительность и размер коммита (`RuntimeOptions.onCommitTiming`), длительность рассылки, память.
- [ ] `GET /metrics`. Наружу не выходит: Caddy проксирует на сервер только перечисленные пути.
- [ ] Тесты: формат вывода, подсчёт в Hub и рантайме.

## 8b. Чат

- [ ] Миграция: `chat_messages` (`id bigserial`, `season_id`, `user_id`, `text`, `created_at`, `deleted_at`, `deleted_by`; индексы `(season_id, id)`, `(user_id, created_at)`), `users.chat_muted_until`, `users.chat_mute_reason`.
- [ ] `MOD_ACTIONS` += `chat_mute`, `chat_unmute`, `chat_delete`.
- [ ] `chat/service.ts` — `ChatService`:
  - `send(user, text)`: нормализация (обрезка, переводы строк → пробел), проверки `chat_disabled` / `empty` / `too_long` / `no_access` (бан, гильдия, возраст — как у игры) / `muted` / `cooldown` (в памяти, по `cooldownMs`); вставка; рассылка через Hub;
  - отключения чата: кэш `Map<userId, { until, reason }>` из БД при старте; `mute`, `unmute` (БД + `mod_log` в одной транзакции, затем кэш и новый `player` игроку);
  - `deleteMessage(admin, id)`, `deleteRecent(admin, userId, sinceMs)`: `deleted_at`, `mod_log`, рассылка `chat_deleted`;
  - ночная очистка старше `retentionDays` (раз в час проверка, как чистка сессий).
- [ ] Протокол (`@rave/shared`): `ChatMessage = { type: "chat"; id; author: UserRef; text; at }`, `{ type: "chat_deleted"; ids }`, `timeline_history` вместо `feed_history`; `PlayerView` += `chatMutedUntil: number | "permanent" | null`, `chatMuteReason`; `PROTOCOL_VERSION = 3`.
- [ ] Hub: общая лента (события и сообщения) размером `chat.historySize`; `timeline_history` после `hello`; `publishChat`, `publishChatDeleted`; восстановление ленты при старте из `bombs` и `chat_messages` (`chat/timeline.ts`).
- [ ] tRPC: `chat.send` (playerProcedure), `admin.chat.mute` / `unmute` / `delete` / `deleteRecent`. В `admin.players.get` — состояние чата.
- [ ] Клиент (минимально, чтобы не сломался): `timeline_history` → события в текущую ленту, `chat`/`chat_deleted` пока игнорируются.
- [ ] Тесты: все коды отказа `send`, нормализация, кулдаун, отключение и возврат чата, удаление и рассылка, история при подключении (порядок, размер), восстановление после рестарта, очистка по сроку, протокол v3.

## 8c. Дашборд и список игроков

- [ ] Миграция: `stats_hourly` (`season_id`, `hour timestamptz`, `pixels`, `explosions`, `defuses`, `online_peak`, `minted_pixels`, `minted_daily`, `minted_bomb_bonus`, `minted_defuse`, `minted_admin`, `spent_bomb`, `spent_detector`, `spent_defuser`, `spent_color`, `spent_boost`, `spent_penalty`, `spent_admin`; PK `(season_id, hour)`); индекс `pixel_events (season_id, created_at)`.
- [ ] `stats/hourly.ts` — `HourlyStats`: копит счётчики из закоммиченных событий (`onCommit`) и пик онлайна (Hub), раз в минуту и при остановке пишет upsert-ом (суммы — сложением, пик — `greatest`).
- [ ] `admin.dashboard({ period: "1h" | "24h" | "7d" })`: онлайн сейчас и пик; пиксели, взрывы, обезвреживания; активные бомбы; монеты выпущено/потрачено по источникам и в обороте (сумма балансов в движке); ряд по часам; новые игроки и отклонённые по возрасту; топ-5 активных за час (пиксели, поставленные бомбы, подрывы); последние 5 записей `mod_log`; снимок метрик сервера. Перед запросом — сброс накопленного.
- [ ] `admin.players.list({ filter, sort, dir, page })`: фильтры `all | online | banned | new | muted` со счётчиками, сортировка по пикселям за 7 дней, монетам, активным бомбам, последнему входу, имени; по 50 на страницу.
- [ ] Тесты: агрегатор (события → колонки, пик, переживает рестарт), дашборд на синтетических данных, список игроков (каждый фильтр, сортировка, страницы).

## Порядок и проверки

Каждая часть: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build:web` локально → коммиты → push → CI зелёный → следующая часть.
