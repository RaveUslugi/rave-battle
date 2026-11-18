# Rave Battle

Плейсхолдер-страница: сезон 1 завершён, рядом холст сезона.

```bash
npm install
npm run dev
```

Файлы: `src/App.tsx`, `src/App.module.css`, `src/index.css` (токены и `@font-face`), шрифты в `public/fonts`, холст в `public/canvas.png`.

## Деплой

GitHub Pages, домен `shitcoderz.com`. Источник: GitHub Actions (`.github/workflows/pages.yml`);
каждый push в `placeholder` собирает `dist` и публикует его. Локальная сборка: `npm run build`.

`public/CNAME` (`shitcoderz.com`) попадает в `dist` и задаёт кастомный домен для артефакта.

DNS в Cloudflare: `A`/`AAAA` на apex проксируются к Pages. Pages при этом работает и на
`raveuslugi.github.io/rave-battle/`, но отдаёт 301 на кастомный домен.
