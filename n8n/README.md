# n8n воркфлоу для AI-планировщика

## TL;DR

В этой папке два воркфлоу:

| Файл | Когда использовать | Стек |
|---|---|---|
| **`workflow-planner-openai.json`** ← рекомендуется для старта | У тебя есть **только OpenAI API ключ**. Без БД. Маршрут уходит письмом. | OpenAI gpt-4o-mini · SMTP · без БД |
| `workflow-planner.json` | Старый вариант для GigaChat + Supabase. Когда вырастешь и захочешь верифицированный whitelist мест и сохранять лиды в БД. | GigaChat · Supabase Postgres |

## Архитектура (OpenAI вариант)

```
Browser form (PlannerForm.astro)
        │  POST {tier, city, days, composition, transport, budget, topic, notes, email, ...premium fields}
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ n8n: Crimea Planner — OpenAI + HTML Email (Free + Premium)                  │
│                                                                              │
│  Webhook ─▶ Validate ─▶ Fetch Attractions ─▶ Fetch Transport ─▶ Fetch Food │
│                          (95 точек)         (68 опций)         (75 мест)   │
│                                                                       │     │
│                                                                       ▼     │
│                                                              Build Prompt   │
│                                                                       │     │
│                                                                       ▼     │
│  Respond OK ◀── Send Email (SMTP) ◀── Render HTML email ◀── OpenAI         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Что происходит**:
1. Форма на сайте делает POST на webhook URL n8n с CORS `*`. Поле `tier` определяет free / premium.
2. **Validate** — проверка email, нормализация: переводит коды (`yalta`, `couple`, `obzor`) в человеческие названия для промпта; нормализует tier и премиум-поля.
3. **Fetch Attractions Catalog** — HTTP GET на `https://welcomecrimea.ru/data/attractions.json` подтягивает каталог из 95 проверенных мест Крыма (адреса, часы, цены, координаты).
4. **Fetch Transport Catalog** — HTTP GET на `https://welcomecrimea.ru/data/transport.json` подтягивает каталог из 68 проверенных опций транспорта (поезда «Таврия», троллейбус №52А, маршрутки, такси, аренда авто, канатки, морские прогулки, Крымский мост).
5. **Fetch Food Catalog** — HTTP GET на `https://welcomecrimea.ru/data/food.json` подтягивает каталог из 75 проверенных ресторанов/кафе/столовых/виноделен (Чайка в Ялте, Мусафир в Бахчисарае, Кефало-Вриси в Балаклаве, Дорадо в Алуште, Караман в Евпатории, винодельни Massandra/Inkerman/Esse/Solnechnaya Dolina/Alma Valley и др.).
6. **Build Tier-aware Prompt** — фильтрует каталог достопримечательностей по региону (city), фильтрует транспорт по выбранному способу (car/public/taxi/mixed) и связанным городам, фильтрует еду по региону и составу (для семей с детьми приоритет kid_friendly; для gastro-туров приоритет винодельням), сортирует по приоритету (релевантные теги + «обязательно»), инжектит все три каталога в system+user prompt. Для free — компактный (4–6 точек/день, ~15 ресторанов); для premium — расширенный (6–8 точек/день, ~30 ресторанов, рестораны по дням, план Б, чек-лист).
7. **OpenAI** — `gpt-4o-mini` с `response_format=json_object` возвращает структурированный план. Системный промпт явно запрещает выдумывать места, рестораны и способы транспорта — AI берёт только из каталогов.
8. **Render HTML** — превращает JSON в красивое HTML-письмо в стиле сайта (serif, navy/cream/burgundy). Для premium дополнительно рендерит секции рестораны / план Б на дождь / чек-лист.
9. **Send Email** — отправляет через SMTP.
10. **Respond OK** — фронт получает `{ok:true, message:"План отправлен на ..."}` и показывает пользователю.

Время от submit до получения письма: **10–20 секунд** (premium ближе к 20). Стоимость одного маршрута: **~$0.002–0.005** (gpt-4o-mini, 4000–7000 input токенов из-за каталога + 2000–4000 output).

## Зачем именно так (а не PDF)

n8n не имеет нативной PDF-ноды. Варианты:

- ✅ **HTML email** (этот воркфлоу). Доставляется лучше PDF, мобильно, кликабельные ссылки, ничего лишнего.
- 🟡 **PDFShift API** (250 PDF/мес бесплатно). Подключается одной HTTP Request нодой — см. ниже «Опционально: PDF».
- 🟡 **Self-hosted Gotenberg** (Docker контейнер для HTML→PDF). Бесплатно, но нужен сервер.
- ❌ Свои PDF-ноды для n8n (`n8n-nodes-pdf` etc.) — community packages, требуют self-hosted и доверия к мейнтейнеру.

Рекомендую начать с HTML email — это покрывает 95% юзкейсов и доставка лучше.

## Установка n8n (бесплатно)

### Вариант A: n8n Cloud (проще всего, $20/мес)

https://n8n.io/cloud/ — Starter план $20/мес, 5к executions, без забот с инфрой.

### Вариант B: Render (free tier, ~10 минут)

1. https://render.com → New → **Web Service**
2. Source: `n8nio/n8n` (Docker image)
3. Plan: **Free** (засыпает после 15 мин неактивности — для прод недостаточно, но для тестов норм)
4. Environment variables:
   ```
   N8N_HOST=<your-render-url-without-https>
   WEBHOOK_URL=https://<your-render-url>/
   N8N_PROTOCOL=https
   N8N_PORT=5678
   GENERIC_TIMEZONE=Europe/Moscow
   ```
5. После деплоя открыть URL → создать админ-аккаунт.

### Вариант C: Railway ($5 free credits/мес)

1. https://railway.app → New Project → Deploy a Template → искать **n8n**
2. После деплоя: Settings → Networking → Generate Domain
3. Открыть URL, создать админ-аккаунт.

### Вариант D: Oracle Cloud Free Tier (навсегда бесплатно, но сложнее)

1. https://www.oracle.com/cloud/free — создать аккаунт.
2. Поднять Always Free ARM-инстанс (4 OCPU, 24 GB RAM).
3. Установить Docker, запустить:
   ```bash
   docker run -d --restart=always -p 5678:5678 \
     -v ~/.n8n:/home/node/.n8n \
     -e N8N_HOST=your.domain \
     -e WEBHOOK_URL=https://your.domain/ \
     -e GENERIC_TIMEZONE=Europe/Moscow \
     n8nio/n8n
   ```
4. Накатить Caddy/nginx с Let's Encrypt для HTTPS:
   ```caddy
   your.domain {
     reverse_proxy localhost:5678
   }
   ```

## Импорт воркфлоу

1. В n8n: **Workflows → Add workflow → Import from File** → выбрать `workflow-planner-openai.json`.
2. Должно появиться **10 нод** (Webhook → Validate → Fetch Attractions Catalog → Fetch Transport Catalog → Fetch Food Catalog → Build Prompt → OpenAI → Render → Send Email → Respond). **Не активируй** воркфлоу пока не подключишь creds.

> **Каталоги проверенных мест, транспорта и еды**: ноды `Fetch Attractions Catalog`, `Fetch Transport Catalog` и `Fetch Food Catalog` тянут `https://welcomecrimea.ru/data/attractions.json` (95 точек), `https://welcomecrimea.ru/data/transport.json` (68 опций) и `https://welcomecrimea.ru/data/food.json` (75 ресторанов/кафе/виноделен) соответственно. Все три файла лежат в репо в `public/data/` и обновляются деплоем GitHub Pages автоматически. Если хочешь добавить/убрать данные — правь `src/data/*.json`, копию в `public/data/`, и закоммить — после деплоя каталоги обновятся без необходимости пересохранять workflow в n8n.

## Подключение OpenAI

1. В n8n: **Credentials → Add credential** → искать **OpenAI**.
2. Поле `API Key`: твой ключ из https://platform.openai.com/api-keys.
3. Сохрани. Запомни имя (например, `OpenAI account`).
4. В воркфлоу клик на ноду **OpenAI: Generate Itinerary** → в поле Credentials выбери созданный credential.

> На случай если в РФ доступ к OpenAI закрыт: можно использовать прокси типа https://proxyapi.ru или https://aitunnel.ru. В ноде поменяй URL с `https://api.openai.com/v1/chat/completions` на URL прокси.

## Подключение SMTP (для отправки писем)

Самый простой путь — Gmail с App Password. Альтернативы: Yandex.Mail (`smtp.yandex.ru`), Mail.ru, любой ваш почтовый провайдер.

### Gmail App Password (5 минут)

1. Включи 2FA на своём Google-аккаунте: https://myaccount.google.com/security
2. Перейди https://myaccount.google.com/apppasswords → создай новый password (имя: `n8n`).
3. В n8n: **Credentials → Add credential** → **SMTP**.
4. Заполни:
   - User: `your.email@gmail.com`
   - Password: `<16-значный App Password>`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - SSL/TLS: **on**
5. Сохрани (имя: `SMTP account`).
6. В воркфлоу клик на ноду **Send Email (SMTP)** → выбери credential. В поле `From Email` поставь свой Gmail.

### Yandex.Mail

- Host: `smtp.yandex.ru`
- Port: `465`
- SSL: on
- В Yandex включи «Доступ для почтовых клиентов» в настройках безопасности.

## Активация и тест

1. Жми **Save** на воркфлоу, потом **Activate** (тумблер вверху справа).
2. Кликни на ноду `Webhook (form submit)` → скопируй **Production URL** (выглядит как `https://your-n8n.example.com/webhook/crimea-planner`).
3. Тест free-тарифа из терминала:
   ```bash
   curl -X POST https://your-n8n.example.com/webhook/crimea-planner \
     -H "Content-Type: application/json" \
     -d '{
       "tier": "free",
       "city": "yalta",
       "days": 5,
       "composition": "couple",
       "transport": "car",
       "budget": 5000,
       "topic": "obzor",
       "notes": "первый раз в Крыму",
       "email": "your.email@example.com"
     }'
   ```
4. Тест premium-тарифа:
   ```bash
   curl -X POST https://your-n8n.example.com/webhook/crimea-planner \
     -H "Content-Type: application/json" \
     -d '{
       "tier": "premium",
       "city": "krym",
       "days": 7,
       "composition": "family-kids",
       "transport": "car",
       "budget": 8000,
       "topic": "obzor",
       "comfort": "comfort",
       "arrivalPoint": "simferopol",
       "arrivalDate": "2026-06-15",
       "departureDate": "2026-06-22",
       "allergies": "нет",
       "notes": "",
       "email": "your.email@example.com"
     }'
   ```
5. Через 10–20 секунд должно прийти письмо. В n8n в **Executions** видно как прошёл каждый шаг.
6. **Проверь**: места в письме должны быть из каталога `src/data/attractions.json` — никаких выдуманных названий. Если AI возвращает имя, которого нет в каталоге — открой ноду Render HTML email → Output → проверь содержимое `plan.days[].items`.

> **Возможные ошибки**:
> - `Fetch Attractions Catalog` → 404: домен `welcomecrimea.ru` ещё не задеплоил каталог. Подожди или поменяй URL в ноде на `https://artemida2.github.io/crimea/data/attractions.json` пока DNS не обновился.
> - OpenAI вернул не JSON: внутри Render HTML есть fallback-парсинг — если совсем сломалось, посмотри ноду `OpenAI` → Output, оттуда `choices[0].message.content`.

## Подключение к фронту

В этом репо `src/components/PlannerForm.astro` уже читает webhook URL из env переменной `PUBLIC_N8N_WEBHOOK`. Два способа задать:

### Способ 1: GitHub Actions secret (для прод-сборки)

1. В репо: **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Name: `PUBLIC_N8N_WEBHOOK`
3. Value: `https://your-n8n.example.com/webhook/crimea-planner`
4. В `.github/workflows/deploy.yml` шаг build получает её через `env`. Изменения в этом репо уже добавлены.

### Способ 2: Локальный `.env`

Создай `.env` в корне (он в gitignore):
```
PUBLIC_N8N_WEBHOOK=https://your-n8n.example.com/webhook/crimea-planner
```
Запусти `npm run dev` — форма будет слать на этот URL.

## Опционально: добавить PDF к письму

Если хочешь приложить PDF (например, для премиум-плана за 299₽):

1. Зарегистрируйся на https://pdfshift.io (250 бесплатных PDF/мес, дальше $9/мес за 1000 шт).
2. Получи API key.
3. В n8n добавь ноду **HTTP Request** между `Render HTML email` и `Send Email`:
   - Method: `POST`
   - URL: `https://api.pdfshift.io/v3/convert/pdf`
   - Authentication: **Basic Auth**
     - User: `api`
     - Password: `<your-pdfshift-api-key>`
   - Send Body: yes, JSON:
     ```json
     {
       "source": "{{ $json.html }}",
       "format": "A4",
       "margin": "20mm"
     }
     ```
   - Response → Response Format: **File** (выбери binary).
4. На ноде **Send Email** в поле **Attachments** укажи: `data` (имя binary поля от PDFShift).

Готово — письмо приходит с PDF-приложением.

## Если будет много трафика

OpenAI gpt-4o-mini стоит ~$0.15 за 1M input + $0.60 за 1M output. Один маршрут ≈ 1500 input + 2000 output токенов = **~$0.0015 за маршрут**. На 1000 маршрутов в месяц — $1.5.

Защити webhook от спама:
- Добавь капчу (Cloudflare Turnstile, бесплатно).
- В n8n поставь **rate-limit** ноду в начале флоу (например, не больше 5 запросов с одного email в час) — добавляется через ноду **Code** + Redis или просто `staticData`.

## Старый воркфлоу (GigaChat + Supabase)

Файл `workflow-planner.json` — для будущего масштабирования. Когда:
- Будет каталог 100+ верифицированных мест → запретить AI выдумывать.
- Захочется собирать лиды для ремаркетинга.
- Нужны будут русскоязычные ответы лучше OpenAI (GigaChat бывает точнее в русских реалиях).

См. `workflow-planner.json` — там нужны:
- Supabase (Postgres + таблицы `places`, `leads`).
- GigaChat API token.
