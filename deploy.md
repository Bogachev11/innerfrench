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
- `004_srs.sql` — прогресс повторений (`user_word_progress`)

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
npx tsx scripts/resolveUrls.ts 1 190
```

Обходит пагинацию `innerfrench.com/podcast` и обновляет реальные `source_url` в `scripts/data/episodes.json`.

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

### 4.6. Ночной батч с возобновлением после ошибок

```bash
# пример: обработать 13-190
npx tsx scripts/nightBatch.ts --start 13 --end 190 --model tiny --continue-on-error --max-retries 2

# если остановилось на ошибке/свет вырубился
npx tsx scripts/nightBatch.ts --resume
```

Checkpoint сохраняется в `scripts/data/night_batch_state.json`.
Список проблемных эпизодов пишется в поле `failed`.

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

## 7. Деплой на прод (обязательный порядок)

**Важно:** прод собирается **только с ветки `main`**. Никогда не пушить в main один файл — всегда смерживать **весь** `develop`, иначе на проде не будет зависимостей (recharts, TopTabs и т.д.) и билд упадёт или интерфейс будет старый.

### 7.1. Настройка Vercel (один раз)

1. **Git**: Vercel Dashboard → Project → **Settings** → **Git** → **Production Branch** = `main`. Иначе прод будет собираться с другой ветки.
2. **Переменные**: Settings → **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` (Production)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production)
   - `OPENAI_API_KEY` (Production)  
   `SUPABASE_SERVICE_ROLE_KEY` на Vercel не нужен (только для локальных скриптов).

### 7.2. Обычный деплой (каждый раз так)

1. **Всё закоммитить на develop** (все изменённые файлы фичи, включая `package.json` при новых зависимостях):
   ```bash
   git checkout develop
   git add -A
   git status   # проверить, что в коммит входит всё нужное
   git commit -m "описание изменений"
   git push origin develop
   ```

2. **Проверить билд локально** (чтобы на Vercel не упало):
   ```bash
   npm run build
   ```

3. **Смержить develop в main и запушить**:
   ```bash
   git checkout main
   git pull origin main
   git merge develop -m "Deploy: описание"
   git push origin main
   git checkout develop
   ```

4. **Проверить прод**: Vercel сам соберёт из `main`. Через 1–2 мин открыть https://innerfrench.bogachev.fr. Жёсткое обновление: Ctrl+F5.

5. **Если прод не обновился** (автодеплой с GitHub не сработал) — задеплоить вручную с main:
   ```bash
   git checkout main && git pull origin main && npx vercel --yes --prod && git checkout develop
   ```
   Проверка прода: `npx tsx scripts/testProd.ts` (при необходимости `PROD_URL=https://... npx tsx scripts/testProd.ts`).

### 7.3. Если на проде не видно обновлений

1. **Vercel Dashboard** → **Deployments**: открыть последний деплой с ветки **main**. Статус **Ready** или **Error**?
2. Если **Error** — открыть билд, посмотреть лог (часто нет `recharts` или другая зависимость).
3. **Settings** → **Git** → **Production Branch** должен быть именно `main`.
4. **Redeploy**: Deployments → у последнего деплоя меню (три точки) → **Redeploy** (при необходимости с **Clear Build Cache**).
5. В браузере: жёсткое обновление (Ctrl+F5) или режим инкогнито, чтобы отбросить кэш.

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
    api/word-translate/ — серверный перевод слова (OpenAI)
    api/word-info/      — грамматика и пример для карточки слова
    episodes/           — список эпизодов
    episodes/[slug]/    — плеер с транскриптом
    dashboard/          — статистика прослушиваний
    vocab/              — карточки слов (SRS)
    word-count/         — графики: словоформы, добавленные/пройденные слова
    TopTabs.tsx         — навигация (Episodes, Progress, Words, Word Count)
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
