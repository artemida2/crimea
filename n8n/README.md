# n8n воркфлоу

## Что это

Бэк для AI-планировщика маршрутов. Принимает POST с формы фронта, обращается к
GigaChat (или другому LLM), сохраняет лид в Supabase Postgres, возвращает JSON с
маршрутом.

Файл [workflow-planner.json](./workflow-planner.json) — готовый workflow для
импорта в n8n.

## Установка n8n (бесплатно)

### Вариант 1: Railway (~5 минут)

1. Зайти на https://railway.app, авторизоваться через GitHub.
2. New Project → Deploy a Template → искать "n8n".
3. После деплоя открыть Settings → Networking → Generate Domain.
4. Открыть полученный URL в браузере, создать админ-аккаунт.

Бесплатный лимит — $5 кредитов/мес, обычно хватает на тестовый трафик.

### Вариант 2: Oracle Cloud Free Tier (бессрочно бесплатно)

1. Создать аккаунт на https://www.oracle.com/cloud/free.
2. Поднять Always Free инстанс ARM (4 OCPU, 24 GB RAM).
3. Установить Docker, запустить:
   ```bash
   docker run -d --restart=always -p 5678:5678 \
     -v ~/.n8n:/home/node/.n8n \
     -e N8N_HOST=your.domain \
     -e WEBHOOK_URL=https://your.domain/ \
     n8nio/n8n
   ```
4. Накатить Caddy/nginx с Let's Encrypt для HTTPS.

### Вариант 3: n8n Cloud ($20/мес)

Самый простой вариант, но платный.
https://n8n.io/cloud/

## Импорт workflow

1. В n8n нажать **Workflows → Import from File** и выбрать `workflow-planner.json`.
2. Кликнуть на ноду **places** → подключить креды Postgres (Supabase).
3. Кликнуть на ноду **GigaChat** → вставить токен в поле Header `Authorization`.
4. Кликнуть на ноду **Save lead** → подключить те же креды Postgres.
5. **Activate** workflow.
6. Скопировать webhook URL (на ноде `Webhook (form submit)` → Production URL).
7. Вставить этот URL в `src/components/PlannerForm.astro`, переменная `N8N_WEBHOOK`.

## Подготовка Supabase

1. Зарегистрироваться на https://supabase.com (бесплатный tier).
2. Создать новый проект.
3. SQL Editor → выполнить:
   ```sql
   create table places (
     slug text primary key,
     title text not null,
     city text not null,
     category text,
     lat double precision,
     lng double precision,
     short_description text,
     verified boolean default true
   );

   create table leads (
     id bigserial primary key,
     email text,
     city text,
     days int,
     composition text,
     transport text,
     budget int,
     topic text,
     notes text,
     plan_json jsonb,
     created_at timestamptz default now()
   );

   -- Индексы
   create index idx_leads_email on leads(email);
   create index idx_leads_created_at on leads(created_at desc);
   ```
4. Заполнить таблицу `places` начальными верифицированными местами:
   ```sql
   insert into places (slug, title, city, category, lat, lng, short_description) values
     ('lastochkino-gnezdo', 'Ласточкино гнездо', 'Гаспра', 'Памятник архитектуры', 44.4307, 34.1287, 'Замок на скале мыса Ай-Тодор'),
     ('chufut-kale', 'Чуфут-Кале', 'Бахчисарай', 'Пещерный город', 44.7414, 33.9203, 'Средневековый пещерный город'),
     ('obyekt-825-gts', 'Объект 825 ГТС', 'Балаклава', 'Военный музей', 44.5024, 33.6011, 'Бывшая база подводных лодок');
   -- Добавить остальные 50+ мест из списка по мере роста контента
   ```
5. Project Settings → Database → скопировать connection string в n8n Postgres credentials.

## GigaChat: получение токена

1. Зарегистрироваться на https://developers.sber.ru/portal/products/gigachat-api.
2. Создать проект, получить Client ID и Client Secret.
3. Получить access token (живёт 30 минут, нужен auto-refresh):
   ```bash
   curl -L -X POST 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth' \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -H 'Accept: application/json' \
     -H 'RqUID: <uuid-v4>' \
     -H 'Authorization: Basic <base64(ClientID:ClientSecret)>' \
     -d 'scope=GIGACHAT_API_PERS'
   ```
4. В n8n добавить отдельную ноду, которая по cron каждые 25 минут обновляет токен в `staticData`. Или проще — поднять refresh внутри основного флоу.

## Альтернативные AI-провайдеры

Если GigaChat не подходит:

- **YandexGPT**: https://yandex.cloud/ru/docs/foundation-models/api-ref/. Замените URL и payload в ноде `GigaChat`.
- **OpenAI/Claude через прокси**: используйте сторонние OpenAI-совместимые прокси для РФ (например, `proxyapi.ru`).

## Защита от галлюцинаций

Workflow предотвращает выдумывание мест двумя механизмами:

1. **Whitelist в БД** — нода `places` подгружает только верифицированные объекты.
2. **Системный промпт** — явно запрещает использовать места не из списка.

При росте каталога важно обновлять `places` — иначе AI будет генерить однообразные
маршруты только по 3 местам.

## Тарификация

Примерные расходы:

- GigaChat — ~3 ₽ за один маршрут (1500–2000 токенов)
- Supabase Free — 500 MB БД, 2 GB трафика бесплатно
- Railway — $5/мес кредитов в Free tier
- Oracle Cloud Free — навсегда бесплатно

При 10к маршрутов/мес — расходы ~30к ₽ только на AI. Поэтому для бесплатного тира
введите rate-limit (1 запрос в минуту с IP) или капчу.
