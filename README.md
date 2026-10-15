# Rave Battle

Мультиплеерная браузерная игра для Discord-сервера: общий pixel battle-холст со встроенной механикой сапёра.

Игроки входят через Discord и красят клетки общего холста, тратя заряды, которые восстанавливаются со временем. Свой пиксель можно заминировать: кто попытается его перекрасить, подорвётся. Бомбы невидимы для всех, их ищут расходными инструментами сапёра: детектор показывает число бомб в квадрате 3×3, дефьюзер снимает бомбу. Ещё в игре есть монеты, магазин, ежедневные задания, рейтинги, профиль и админка с модерацией холста. Все игровые числа задаются динамическим конфигом и меняются в админке на лету.

## Стек

- [Bun](https://bun.sh) 1.3.6, монорепо на workspaces, TypeScript
- **Сервер** (`apps/server`): `Bun.serve`, tRPC 11, нативный WebSocket, PostgreSQL 17 через drizzle-orm
- **Клиент** (`apps/web`): React 19, Vite, PixiJS 8, zustand, TanStack Query
- **Общий код** (`packages/shared`): протокол, схема конфига, игровые правила

## Быстрый локальный запуск

Нужны Bun 1.3.6 и Docker с Compose v2.

```bash
bun install
cp .env.example .env
bun run db:up
```

`db:up` поднимает Postgres в Docker на порту `54329` с базами `rave` и `rave_test`.

Затем в двух терминалах:

```bash
bun run dev:server
```

```bash
bun run dev:web
```

Откройте http://localhost:5173. Vite проксирует API и WebSocket на сервер (`:3000`).

При первом запуске сервер сам применяет миграции и создаёт игровой конфиг по умолчанию.

### Вход без Discord

В `.env.example` включён dev-вход (`DEV_LOGIN=1`). На странице игры введите любое имя (латиница, цифры, `_`) и нажмите «Dev». Discord-ключи для локальной разработки не нужны.

Имя `admin` даёт права администратора, админка открывается по адресу http://localhost:5173/admin.

Остановить базу: `bun run db:down`. Данные сохраняются в Docker-томе.

## Проверки

```bash
bun test
```

```bash
bun run typecheck
```

```bash
bun run build:web
```

E2E-тесты (Playwright) поднимают отдельный прод-подобный стек на `localhost:8080` и после прогона удаляют его. Перед первым запуском установите Chromium: `bunx playwright install chromium`.

```bash
bun run e2e
```

## Деплой

Прод-стек: Docker Compose, в нём Postgres, игровой сервер, Caddy с HTTPS и ночные бэкапы. Пошаговая инструкция — в [docs/deploy.md](docs/deploy.md).

## Документация

- [Спецификация](docs/superpowers/specs/2026-10-07-rave-battle-design.md): правила игры и архитектура
- [Спецификация v1.1](docs/superpowers/specs/2026-10-15-rave-battle-v1.1-design.md): i18n, эффектные цвета, Biome и CI, нагрузочный тест, метрики
- [Roadmap](docs/superpowers/plans/2026-10-07-00-roadmap.md): планы реализации и что осталось после v1
