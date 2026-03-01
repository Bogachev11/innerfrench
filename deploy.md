# InnerFrench — порядок деплоя

## Стек

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS 4
- **Supabase** (Postgres) — БД + API
- **Vercel** — хостинг
- **Домен**: innerfrench.bogachev.fr

---

## 1. Клонирование и установка

```bash
git clone https://github.com/Bogachev11/innerfrench.git
cd innerfrench
npm install
```

## 2. Переменные окружения

Создать `.env.local` в корне проекта:

```
NEXT_PUBLIC_SUPABASE_URL=https://wrrlqnrvkeadawseyyyb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_DB_PASSWORD=<пароль БД>
OPENAI_API_KEY=<openai key для перевода слов>
```

Ключи берутся из Supabase Dashboard → Settings → API.

## 3. Миграция БД (однократно)

```bash
npx tsx scripts/runMigration.ts
```

Применяет все SQL-файлы из `supabase/migrations/` по порядку:
- `001_schema.sql` — базовые таблицы (`episodes`, `segments`, `episode_progress`, `listening_sessions`)
- `002_rls.sql` — RLS-политики для MVP
- `003_vocab.sql` — таблицы словаря (`words`, `user_words`)

## 4. Импорт эпизодов

### 4.1. Авторизация на InnerFrench (нужна подписка)

```bash
npx tsx scripts/auth.ts
```

Откроется браузер → залогиниться → куки сохранятся в `.cookies.json`.

### 4.2. Список эпизодов из RSS

```bash
npx tsx scripts/fetchEpisodeList.ts
```

Сохраняет `scripts/data/episodes.json` (все ~190 эпизодов из Podbean RSS).

### 4.3. Уточнение URL для нужных эпизодов

```bash
npx tsx scripts/resolveUrls.ts
```

Проверяет реальные URL через Playwright (нужны куки из шага 4.1).

### 4.4. Скрейпинг контента (транскрипт + аудио)

```bash
npx tsx scripts/importEpisode.ts
```

Для каждого эпизода извлекает: аудио URL, таймкоды, французский текст.
Результат: `scripts/data/episode_N.json`.

### 4.5. Загрузка в Supabase

```bash
npx tsx scripts/pushToSupabase.ts
```

Заливает эпизоды и сегменты в БД.

## 5. Перевод FR → RU (нейросеть)

Требуется Python 3.12+ с пакетами:

```bash
pip install argostranslate supabase python-dotenv
```

Запуск:

```bash
python scripts/translate_neural.py
```

Использует argostranslate (OpenNMT/CTranslate2) для перевода FR → RU.
Переводит только сегменты с пустым `ru_text`.

### Ручная загрузка переводов (альтернатива)

```bash
npx tsx scripts/uploadTranslation.ts <номер_эпизода> <путь_к_json>
```

JSON формат: `[{ "idx": 0, "ru_text": "Текст" }, ...]`

## 6. Локальная разработка

```bash
npm run dev
```

Открыть http://localhost:3000

## 7. Деплой на Vercel

### Первый раз

```bash
vercel --yes --prod
```

### Переменные на Vercel

В Vercel Dashboard → Project Settings → Environment Variables добавить:

| Переменная | Окружение |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production |
| `OPENAI_API_KEY` | Production |

`SUPABASE_SERVICE_ROLE_KEY` на Vercel **не нужен** (используется только в локальных скриптах импорта/админки).

### Последующие деплои

```bash
git add -A && git commit -m "описание" && git push
vercel --yes --prod
```

Или настроить авто-деплой через Vercel GitHub Integration (уже подключен).

## 8. Настройка домена

В Vercel:

```bash
vercel domains add innerfrench.bogachev.fr
```

В DNS-панели LWS для bogachev.fr:

| Тип | Имя | Значение |
|---|---|---|
| A | innerfrench | 76.76.21.21 |

SSL выпускается автоматически.

---

## Структура проекта

```
src/
  app/
    api/word-translate/— серверный перевод слова (OpenAI)
    episodes/          — список эпизодов
    episodes/[slug]/   — плеер с транскриптом
    dashboard/         — статистика
    vocab/             — заглушка (будущее)
  lib/
    supabase.ts        — клиент (anon key)
    supabase-admin.ts  — клиент (service role)
    device.ts          — device_id для анонимного трекинга
    types.ts           — TypeScript интерфейсы
scripts/
  auth.ts              — авторизация Playwright
  fetchEpisodeList.ts  — парсинг RSS
  resolveUrls.ts       — уточнение URL эпизодов
  importEpisode.ts     — скрейпинг контента
  pushToSupabase.ts    — загрузка в БД
  uploadTranslation.ts — ручная загрузка переводов
  translate_neural.py  — нейросетевой перевод FR→RU
  runMigration.ts      — применение SQL-миграций
supabase/
  migrations/          — SQL-схема, RLS, словарь
```

## URL

- **Production**: https://20260301frenchpodcasttool.vercel.app
- **Custom domain**: https://innerfrench.bogachev.fr (после настройки DNS)
- **GitHub**: https://github.com/Bogachev11/innerfrench
