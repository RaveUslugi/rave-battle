# syntax=docker/dockerfile:1
FROM oven/bun:1.3.6 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM deps AS build-web
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run build:web

FROM oven/bun:1.3.6 AS server
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production
COPY packages/shared packages/shared
COPY apps/server apps/server
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=120s --start-interval=2s CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "apps/server/src/main.ts"]

FROM caddy:2.10 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build-web /app/apps/web/dist /srv
