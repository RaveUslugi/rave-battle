# Деплой Rave Battle

Один VPS, Docker Compose, четыре сервиса: `postgres`, `server`, `caddy` (отдаёт фронтенд, проксирует API и сам получает HTTPS-сертификат), `backup` (ночные дампы).

```
Интернет --80/443--> caddy --> server:3000 --> postgres:5432
                       |                          ^
                  статика /srv                 backup (pg_dump)
```

Порты `server` и `postgres` наружу не опубликованы. Публичны только 80 и 443 (TCP) и 443/UDP (HTTP/3) у `caddy`.

## 1. Что нужно

- VPS: 2 vCPU, 2-4 ГБ RAM, Ubuntu 24.04 или Debian 12.
- Домен, которым вы управляете.
- Docker Engine и compose plugin: https://docs.docker.com/engine/install/
- Открытые входящие порты 80, 443/tcp и 443/udp (файрвол провайдера и `ufw`, если он включён).

Все команды ниже выполняются в корне репозитория на сервере. Флаг `--env-file .env.production` обязателен в каждой команде `docker compose`: без него compose падает, так как `compose.yml` требует `POSTGRES_PASSWORD` и `DOMAIN`.

## 2. DNS

Создайте A-запись (и AAAA, если у сервера есть IPv6) для домена на IP сервера. Пока запись не распространилась, Caddy не сможет выпустить сертификат. Проверка: `dig +short <домен>`.

## 3. Discord

1. https://discord.com/developers/applications -> New Application.
2. OAuth2 -> Redirects -> добавить `https://<домен>/auth/discord/callback` (точно такой, без слеша в конце: сервер строит его из `PUBLIC_URL`).
3. Со страницы OAuth2 взять Client ID и Client Secret (Reset Secret, если секрета ещё нет). Это `DISCORD_CLIENT_ID` и `DISCORD_CLIENT_SECRET`; задаются только вместе, в production обязательны.
4. `DISCORD_GUILD_ID` (необязательно, ограничивает вход участниками сервера): в Discord включить режим разработчика (Настройки -> Расширенные), ПКМ по серверу -> Копировать ID сервера.
5. `ADMIN_DISCORD_IDS`: свой Discord ID (ПКМ по себе -> Копировать ID пользователя). Несколько ID через запятую, только цифры.

## 4. Первый запуск

```sh
git clone <url репозитория> rave-battle && cd rave-battle
cp .env.production.example .env.production
openssl rand -hex 32        # значение для POSTGRES_PASSWORD
nano .env.production
```

Заполните в `.env.production`:

| Переменная | Значение |
|---|---|
| `DOMAIN` | домен без схемы, например `rave.example.com` |
| `PUBLIC_URL` | `https://<домен>` |
| `POSTGRES_PASSWORD` | вывод `openssl rand -hex 32` |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | из шага 3 |
| `DISCORD_GUILD_ID` | из шага 3 или пусто |
| `ADMIN_DISCORD_IDS` | из шага 3 |

Пароль Postgres подставляется в `DATABASE_URL` без экранирования, поэтому он должен состоять только из букв и цифр. Hex подходит, base64 (`+`, `/`, `=`) сломает URL. Пароль применяется при первом создании тома `pgdata`; смена пароля в `.env.production` позже базу не перенастроит.

Остальное оставьте как в примере (`NODE_ENV=production`, `DEV_LOGIN=0`, `SESSION_TTL_DAYS=30`). Сервер при старте проверяет окружение и падает с понятной ошибкой, если что-то не так (например, не задан Discord).

Запуск:

```sh
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs -f server
```

Ждите строку `Rave Battle server listening on :3000` (Ctrl+C выходит из логов, сервисы продолжают работать). Затем откройте `https://<домен>`. Первый заход может занять несколько секунд: Caddy выпускает сертификат.

## 5. Обновление

```sh
git pull && docker compose --env-file .env.production up -d --build
```

Пересобираются образы, контейнеры пересоздаются. Простой несколько секунд; игроки переподключаются сами, старые вкладки перезагрузятся при смене версии протокола. Данные (том `pgdata`) сохраняются.

## 6. Админка

`https://<домен>/admin`, доступ у Discord ID из `ADMIN_DISCORD_IDS`. Конфиг игры правится только там: `config:defaults` лишь засевает пустую БД и на существующие данные не влияет.

## 7. Бэкапы

Сервис `backup` каждую ночь в 03:00 UTC делает `pg_dump -Fc` в `./backups/rave-YYYYMMDD-HHMMSS.dump` и удаляет дампы старше 14 дней.

Ручной бэкап:

```sh
docker compose --env-file .env.production run --rm -e BACKUP_NOW=1 backup
```

Ожидаемый вывод: `backup ok: /backups/rave-....dump`. При ошибке команда завершается с ненулевым кодом (`backup FAILED`). Ночной сбой только пишется в лог (`docker compose --env-file .env.production logs backup`), повтор будет на следующую ночь, поэтому иногда заглядывайте в лог и в `./backups`.

Важно:

- Файлы в `./backups` принадлежат root (создаёт контейнер), удалять их вручную нужно через `sudo`.
- Бэкапы лежат только на этом сервере. Если сервер или диск пропадут, пропадут и они. Копировать их наружу (`rsync`, `rclone` и т. п.) или нет - решение владельца.

## 8. Восстановление

Из дампа в `./backups`. Подставьте имя файла вместо `rave-XXXX.dump`.

```sh
# 1. остановить сервер (иначе у него открыты соединения с БД)
docker compose --env-file .env.production stop server

# 2. пересоздать пустую базу; --force закрывает оставшиеся соединения (Postgres 13+, у нас 17)
docker compose --env-file .env.production exec postgres dropdb -U rave --force rave
docker compose --env-file .env.production exec postgres createdb -U rave rave

# 3. загрузить дамп (-T обязателен: stdin без TTY)
docker compose --env-file .env.production exec -T postgres pg_restore -U rave -d rave --no-owner < backups/rave-XXXX.dump

# 4. запустить сервер
docker compose --env-file .env.production start server
```

Затем проверьте `logs -f server` (строка `Rave Battle server listening`) и откройте сайт. `caddy` и `backup` останавливать не нужно: `backup` держит соединение с БД только во время дампа. Если дамп делался в момент вашего восстановления, дождитесь его окончания, иначе `dropdb` без `--force` упадёт с ошибкой об активных соединениях.

Восстановление на новом сервере: сделайте "Первый запуск" (раздел 4), скопируйте дамп в `./backups` и выполните шаги 1-4 выше.

## 9. Доступ к БД

```sh
docker compose --env-file .env.production exec postgres psql -U rave rave
```

## 10. Логи и сбои

```sh
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f server     # или caddy, postgres, backup
```

Логи каждого сервиса хранятся в json-file с ротацией: 5 файлов по 10 МБ. Все сервисы имеют `restart: unless-stopped`: если сервер падает (он завершается сразу при ошибке окружения или БД, fail-fast), Docker перезапускает его. Постоянные перезапуски видны в `ps` (Restarting) и в логах `server`: смотрите причину там. После перезагрузки VPS стек поднимается сам, если Docker включён в автозапуск (`sudo systemctl enable docker`).

## 11. Безопасность

- `DEV_LOGIN=0`; сервер в production отказывается стартовать с `DEV_LOGIN=1`.
- Порты Postgres и `server` не опубликованы; наружу смотрит только `caddy`.
- Секреты (`POSTGRES_PASSWORD`, `DISCORD_CLIENT_SECRET`) только в `.env.production`, он не должен попадать в git. Рекомендуется `chmod 600 .env.production`.
- SSH только по ключу: `PasswordAuthentication no` в `/etc/ssh/sshd_config`.
- Держите систему и Docker обновлёнными.
