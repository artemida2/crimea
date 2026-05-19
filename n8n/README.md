# n8n воркфлоу для AI-планировщика и ЮKassa

## TL;DR

В этой папке четыре воркфлоу:

| Файл | Когда использовать | Стек |
|---|---|---|
| **`workflow-planner-openai.json`** ← база | Основной воркфлоу: генерация маршрута + отправка на email. Используется и для free, и для premium. | OpenAI gpt-5-nano · SMTP · без БД |
| **`workflow-yookassa-create-payment.json`** | Принимает POST от формы с `tier=premium`, создаёт платёж в ЮKassa, возвращает `confirmation_url` на фронт. | ЮKassa API · Basic Auth |
| **`workflow-yookassa-notification.json`** | URL `https://hooks.neirolanding.ru/webhook/yookassa-notification`. Принимает webhook от ЮKassa, перепроверяет статус через API, на `payment.succeeded` дёргает `crimea-planner`. | ЮKassa API · Basic Auth |
| `workflow-planner.json` | Старый вариант для GigaChat + Supabase. Когда захочешь верифицированный whitelist мест и сохранять лиды в БД. | GigaChat · Supabase Postgres |

## Архитектура

### Free маршрут (прямой путь)

```
Browser form (PlannerForm.astro)
        │  POST {tier:free, city, days, ...} → PUBLIC_N8N_WEBHOOK
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ workflow-planner-openai.json                                                 │
│  Webhook ─▶ Validate ─▶ Fetch (places/transport/food) ─▶ Build Prompt       │
│                                                                  │           │
│                                                                  ▼           │
│  Respond OK ◀── Send Email (SMTP) ◀── Render HTML ◀── OpenAI (gpt-5-nano)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Premium маршрут (через оплату)

```
Browser form
  │ POST {tier:premium, plannerPayload, email, idempotenceKey} → PUBLIC_N8N_PAYMENT_WEBHOOK
  ▼
┌ workflow-yookassa-create-payment.json ───────────────────────────────────────┐
│  Webhook → Validate & Build payload → YooKassa POST /v3/payments → Respond  │
└──────────────────────────────────────────────────────────────────────────────┘
  │ {confirmation_url, payment_id}
  ▼
Browser → location.assign(confirmation_url) → ЮKassa checkout → оплата картой
         │ redirect: /marshrut/oplata/
         ▼
User видит "Оплата принята"

ЮKassa «параллельно» → webhook:
  ЮKassa POST event.payment.succeeded → https://hooks.neirolanding.ru/webhook/yookassa-notification
  ▼
┌ workflow-yookassa-notification.json ─────────────────────────────────────────┐
│  Webhook → Parse event/IP → GET /v3/payments/{id} (перепроверка) → Respond 200│
│                                                                     │        │
│                                                                     ▼        │
│                                       Reconcile & Decide → Trigger planner   │
└──────────────────────────────────────────────────────────────────────────────┘
  │ POST /webhook/crimea-planner (тот же planner-workflow)
  ▼
тот же первый воркфлоу приходит письмом на email
```

**Что происходит**:
1. Форма на сайте делает POST на webhook URL n8n с CORS `*`. Поле `tier` определяет free / premium.
2. **Validate** — проверка email, нормализация: переводит коды (`yalta`, `couple`, `obzor`) в человеческие названия для промпта; нормализует tier и премиум-поля.
3. **Fetch Attractions Catalog** — HTTP GET на `https://welcomecrimea.ru/data/attractions.json` подтягивает каталог из 95 проверенных мест Крыма (адреса, часы, цены, координаты).
4. **Fetch Transport Catalog** — HTTP GET на `https://welcomecrimea.ru/data/transport.json` подтягивает каталог из 68 проверенных опций транспорта (поезда «Таврия», троллейбус №52А, маршрутки, такси, аренда авто, канатки, морские прогулки, Крымский мост).
5. **Fetch Food Catalog** — HTTP GET на `https://welcomecrimea.ru/data/food.json` подтягивает каталог из 75 проверенных ресторанов/кафе/столовых/виноделен (Чайка в Ялте, Мусафир в Бахчисарае, Кефало-Вриси в Балаклаве, Дорадо в Алуште, Караман в Евпатории, винодельни Massandra/Inkerman/Esse/Solnechnaya Dolina/Alma Valley и др.).
6. **Build Tier-aware Prompt** — фильтрует каталог достопримечательностей по региону (city), фильтрует транспорт по выбранному способу (car/public/taxi/mixed) и связанным городам, фильтрует еду по региону и составу (для семей с детьми приоритет kid_friendly; для gastro-туров приоритет винодельням), сортирует по приоритету (релевантные теги + «обязательно»), инжектит все три каталога в system+user prompt. Для free — компактный (4–6 точек/день, ~15 ресторанов); для premium — расширенный (6–8 точек/день, ~30 ресторанов, рестораны по дням, план Б, чек-лист).
7. **OpenAI** — модель `gpt-5-nano` с `response_format=json_object` возвращает структурированный план. Системный промпт явно запрещает выдумывать места, рестораны и способы транспорта — AI берёт только из каталогов. Для gpt-5-семейства параметры обязательно: `temperature: 1` (другие значения модель отвергает) и `max_completion_tokens` вместо `max_tokens`. Если хочется быстрее/дешевле — `gpt-4o-mini` (тогда `temperature: 0.55` и `max_tokens` работают, см. ниже).
8. **Render HTML** — превращает JSON в красивое HTML-письмо в стиле сайта (serif, navy/cream/burgundy). Для premium дополнительно рендерит секции рестораны / план Б на дождь / чек-лист.
9. **Send Email** — отправляет через SMTP.
10. **Respond OK** — фронт получает `{ok:true, message:"План отправлен на ..."}` и показывает пользователю.

Время от submit до получения письма: **10–20 секунд** для free, **20–35 секунд** для premium (думает дольше, план более детальный). Стоимость одного маршрута зависит от модели — см. секцию «Если будет много трафика» ниже.

### Известные грабли n8n: HTTP Request v4.2 + JSON-массивы (важно)

`Fetch Attractions/Transport/Food Catalog` тянут `.json` файлы, в которых тело ответа — **JSON-массив**. В n8n v1.x на HTTP Request v4.2 такое тело по умолчанию **разворачивается в N отдельных n8n-items** (один item на элемент массива). Это даёт два неприятных эффекта:

1. **Fan-out по цепочке**: если у Fetch-ноды нет `executeOnce: true`, она запускается **по разу на каждый входящий item**. На скриншоте n8n это видно как «6460 items» на стрелке от `Fetch Transport Catalog` — это 95 (attractions) × 68 (transport) = 6460, потому что `Fetch Transport` гонялся 95 раз.
2. **`.first().json` ≠ массив**: в `Build Tier-aware Prompt` чтение через `$('Fetch ... Catalog').first().json` отдаёт **первый элемент массива**, а не сам массив. `Array.isArray(...)` падает на false → каталог считается пустым → AI получает «каталоги пустые» → пользователь получает на email заглушку «Невозможно сформировать маршрут».

**Что сделано в текущем workflow JSON, чтобы это не воспроизводилось:**

- На все три Fetch-ноды добавлен `executeOnce: true` — каждая выполняется ровно один раз независимо от того, сколько items пришло сверху.
- `Build Tier-aware Prompt` читает через `$('Fetch ... Catalog').all()` и нормализует результат: если items=1 и `json` — массив, берём как массив; если items=N — собираем `items.map(it => it.json)`. Это покрывает оба варианта поведения n8n.
- В коде Build стоит `console.log('catalog sizes:', ...)` — в `Executions → Build Tier-aware Prompt → Console` ты увидишь актуальные размеры. Должно быть `95 attractions, 68 transport, 75 food` (или столько, сколько сейчас в каталогах). Если видишь 0 — значит JSON-файл недоступен или сломан, а не баг workflow.

### Что нового в промпте (важно)

Системный промпт теперь явно требует **полезный практический контент**, а не «капитан-очевидность»:
- `local_tip` для каждой точки — что местные знают, а туристы нет (например, «парковка с обратной стороны Воронцовского бесплатно», «троллейбус №52 — сам по себе достопримечательность»).
- `peak_window` — когда там толпы и как их избежать.
- `what_to_order` для каждого ресторана — конкретное блюдо, не «попробуйте местную кухню».
- `avoid_today` — 1–2 предупреждения чего НЕ делать в этот день.
- `morning_strategy` — почему именно эта последовательность утром.
- `cost_breakdown_rub` — реальные числа: входы + еда + транспорт = итого.
- `day_checklist` — чек-лист под конкретный день (для premium).

Эти поля рендерятся в HTML-письме отдельными секциями. Если ты переключаешь модель на более слабую (например, `gpt-4o-mini` ради экономии), некоторые из этих полей могут заполняться не всегда — это нормально, рендер устойчив к отсутствию полей.

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

## Подключение ЮKassa

### 1. Аккаунт и ключи

1. Зарегистрируй ЮKassa-аккаунт на [yookassa.ru](https://yookassa.ru/) (для ИП/ООО нужен ОГРН/ИНН).
2. В личном кабинете: **Интеграция → Ключи API** → выпиши `Shop ID` (число) и `Secret Key` (строка `live_...`).
3. Для тестов включи **тестовый магазин** — там выдадут отдельные `Shop ID` и `test_...` ключ, они не списывают реальные деньги.

### 2. Credential в n8n

Credentials → New → **HTTP Basic Auth** → назови `YooKassa Basic Auth`:
- `User`: твой `Shop ID` (цифры)
- `Password`: твой `Secret Key`

Этот credential используют **оба** YooKassa-воркфлоу (и create-payment, и notification — для перепроверки статуса).

### 3. Импорт воркфлоу

1. Import → `workflow-yookassa-create-payment.json`. В ноде **YooKassa: Create payment** подключи credential `YooKassa Basic Auth`.
2. Import → `workflow-yookassa-notification.json`. В ноде **YooKassa: Verify payment** подключи тот же credential.
3. Активируй оба воркфлоу (toggle Active).

### 4. URL'ы

После импорта вебхуки будут доступны по:

```
https://<твой-n8n-домен>/webhook/yookassa-create-payment   ← в PUBLIC_N8N_PAYMENT_WEBHOOK
https://<твой-n8n-домен>/webhook/yookassa-notification     ← в ЛК ЮKassa
```

На проде эта репа использует:
```
PUBLIC_N8N_PAYMENT_WEBHOOK = https://hooks.neirolanding.ru/webhook/yookassa-create-payment
ЮKassa notification URL   = https://hooks.neirolanding.ru/webhook/yookassa-notification
```

### 5. Регистрация notification URL в ЛК ЮKassa

ЛК ЮKassa → **Интеграция → HTTP-уведомления** → Добавить URL:
- URL: `https://hooks.neirolanding.ru/webhook/yookassa-notification`
- Отметь события: `payment.succeeded`, `payment.canceled`, `refund.succeeded`.

ЮKassa начнёт бить POST'ами на этот URL по каждому из событий. Ожидает ответ `200 OK` внутри 30 секунд, иначе ретраит по экспоненте до 24 часов.

### 6. IP-whitelist (опционально, но желательно на проде)

В `workflow-yookassa-notification.json` в ноде **Parse event & IP** есть `const STRICT_IP_CHECK = false;`. На первый запуск оставь false: если reverse-proxy (Caddy/Nginx/Cloudflare) не прокидывает `X-Forwarded-For`, проверка будет ложно резать события. Когда увидишь в логах реальный IP ЮKassa и убедишься, что он попадает в whitelist (`185.71.76.0/27`, `185.71.77.0/27`, `77.75.153.0/25`, `77.75.154.128/25`, `77.75.156.11`, `77.75.156.35`, `2a02:5180::/32`) — поставь `true`.

Для n8n за reverse-proxy выстави переменную: `N8N_PROXY_HOPS=1` — иначе n8n будет видеть IP прокси, а не ЮKassa.

### 7. 54-ФЗ чек

Для ООО/ИП ЮKassa требует фискальный чек при каждом платеже (отправляет в ОФД). В `workflow-yookassa-create-payment.json` блок `receipt` заполняется автоматически:

```json
"receipt": {
  "customer": { "email": "<email из формы>" },
  "items": [{
    "description": "AI-маршрут по Крыму (премиум)",
    "quantity": "1.00",
    "amount": { "value": "299.00", "currency": "RUB" },
    "vat_code": 1,
    "payment_subject": "service",
    "payment_mode": "full_payment"
  }]
}
```

`vat_code: 1` = без НДС (УСН). Для ОСНО с НДС 20% поставь `4`. Полный список — [docs ЮKassa](https://yookassa.ru/developers/api#create_payment_receipt_items_vat_code). Если поправляешь — меняй в ноде **Validate & Build payload**.

### 8. Тест конца-в-конец

1. На сайте отправь форму с `tier=premium`. Должно средиректить на ЮKassa-checkout.
2. На тестовом магазине ЮKassa введи номер карты `5555 5555 5555 4444`, любые CVV/MM/YY. Оплата пройдёт успешно.
3. ЮKassa редиректит на `/marshrut/oplata/`, параллельно бьёт webhook.
4. В n8n: посмотри executions у **Crimea — YooKassa Notification Handler** — должен быть успех, следом в **Crimea Planner — OpenAI + HTML Email** — вызов и отправка письма.
5. Проверь email — должен прийти премиум-маршрут.

### 9. Отладка

- Если `create-payment` возвращает ошибку — проверь в `Validate & Build payload` длину `plannerPayloadStr` (лимит ЮKassa metadata — 512 символов на значение). Сократи `notes`/`allergies` в форме.
- Если webhook приходит, но planner не вызывается — проверь URL в ноде **Trigger planner workflow**: он должен быть `https://hooks.neirolanding.ru/webhook/crimea-planner` (или твой production-домен).
- Если ЮKassa пишет «webhook не доступен» — проверь, что воркфлоу **Активен** (не draft), и что n8n отвечает 200 (в логах не должно быть HTTP 500).
- Если письмо не приходит — проверь `Send Email (SMTP)` как описано в «Email SMTP» выше.

## Если будет много трафика

OpenAI gpt-5.2 — цены смотри в [прайсе OpenAI](https://openai.com/api/pricing/). На один маршрут уходит ~6000–7000 input + 3000–5000 output токенов (из-за каталога). Если gpt-5.2 слишком дорог — поменяй в ноде **OpenAI: Generate Itinerary** `"model": "gpt-5.2"` на `"gpt-4o-mini"` (в разы дешевле) или `"gpt-4.1"`.

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
