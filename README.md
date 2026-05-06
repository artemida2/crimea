# crimea

AI-планировщик отпуска в Крыму и подробный гид по достопримечательностям.

**MVP** на Astro + GitHub Pages с бэком на n8n + Supabase.

## Что внутри

- `/` — главная: AI-форма «собрать маршрут»
- `/marshrut/` — хаб готовых маршрутов
- `/marshrut/{slug}/` — детальная страница маршрута (план по дням, FAQ, форма-адаптер)
- `/mesta/` — хаб достопримечательностей
- `/mesta/{slug}/` — детальная страница объекта (история, как добраться, цены)
- `/n8n/` — workflow JSON для импорта в n8n + инструкция

Текущий контент: 3 пилотных маршрута, 3 пилотных места. Структура готова к
программатик-расширению — достаточно добавить запись в `src/data/routes.json` или
`src/data/places.json` + контент в `src/content/`.

## Стек

| Слой | Инструмент |
|---|---|
| Фронт | Astro 5, статическая генерация |
| Хостинг | GitHub Pages |
| Бэк | n8n (self-hosted или Cloud) |
| БД | Supabase Postgres (free tier) |
| AI | GigaChat / YandexGPT |
| Платежи | ЮKassa / СБП |

## Запуск локально

```bash
npm install
npm run dev          # http://localhost:4321/crimea/
```

Сайт собирается статически, никакого SSR не требуется:
```bash
npm run build        # → dist/
npm run preview      # локальный сервер на собранном проекте
```

## Деплой

GitHub Actions при пуше в `main` собирает Astro и деплоит на GitHub Pages.

После мёрджа PR один раз сходи в:
- **Settings → Pages → Source: GitHub Actions**

После этого каждый push в main триггерит редеплой автоматически.

Production URL: https://artemida2.github.io/crimea/

## n8n: бэк для AI-формы

См. [n8n/README.md](./n8n/README.md) — там пошаговая инструкция по:
- развёртыванию n8n (Railway / Oracle Free / Cloud)
- импорту workflow
- подключению Supabase и GigaChat
- защите от AI-галлюцинаций

После того как n8n развёрнут, скопируй webhook URL в `src/components/PlannerForm.astro`:
```ts
const N8N_WEBHOOK = "https://your-n8n.example.com/webhook/crimea-planner";
```

До этого форма работает в demo-режиме — выводит параметры без реального вызова AI.

## Структура контента

```
src/
├── data/
│   ├── routes.json       # метаданные маршрутов (slug, title, days...)
│   └── places.json       # метаданные мест (slug, title, facts...)
├── content/
│   ├── routes-content.ts # тексты маршрутов (intro, дни, FAQ)
│   └── places-content.ts # тексты мест (история, советы, FAQ)
├── pages/
│   ├── index.astro
│   ├── marshrut/
│   │   ├── index.astro
│   │   └── [slug].astro   # программатик-страница маршрута
│   └── mesta/
│       ├── index.astro
│       └── [slug].astro   # программатик-страница места
├── components/
│   ├── PlannerForm.astro
│   ├── RouteCard.astro
│   └── PlaceCard.astro
└── layouts/
    └── BaseLayout.astro
```

## Как добавить новый маршрут

1. Добавить запись в `src/data/routes.json`:
   ```json
   {
     "slug": "krym-vinniy-tur-5-dney",
     "title": "Винный тур по Крыму на 5 дней",
     "days": 5,
     ...
   }
   ```
2. Добавить контент в `src/content/routes-content.ts`:
   ```ts
   "krym-vinniy-tur-5-dney": {
     intro: "...",
     days: [...],
     faq: [...]
   }
   ```
3. Запустить `npm run build` — Astro сгенерит страницу `/marshrut/krym-vinniy-tur-5-dney/`.

## SEO

- `sitemap-index.xml` генерится автоматически через `@astrojs/sitemap`
- `robots.txt` в `public/`
- Schema.org разметка: `WebSite`, `TouristTrip`, `TouristAttraction`, `BreadcrumbList`, `FAQPage`
- OG-теги, canonical URL
- Чистые URL с trailing slash

После первого деплоя:
1. Зарегистрировать сайт в [Яндекс.Вебмастер](https://webmaster.yandex.ru/) и [Google Search Console](https://search.google.com/search-console).
2. Загрузить sitemap.
3. Проверить индексацию через 1–2 недели.

## Дорожная карта

- [x] MVP: 3 маршрута + 3 места + AI-форма (заглушка)
- [ ] n8n workflow развёрнут и подключён к форме
- [ ] +50 страниц достопримечательностей (программатик)
- [ ] +30 маршрутов (матрица город × тема × дни)
- [ ] Хаб-страницы по 12 городам
- [ ] PDF-экспорт маршрута
- [ ] Аудиогиды через Yandex SpeechKit
- [ ] ЮKassa интеграция
- [ ] Партнёрки: Tripster, Sutochno

## Лицензия

Проект приватный, лицензия не публичная.
