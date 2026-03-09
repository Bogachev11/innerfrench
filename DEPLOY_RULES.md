# Правила деплоя — нарушать нельзя

## Почему прод откатывался

Прод (innerfrench.bogachev.fr) собирается **только из ветки `main`**. В main попадали не все правки: мержили по одному коммиту (только word-count, только package.json), а остальное (dashboard, эпизоды, Words, оформление) оставалось только на `develop`. В итоге на проде оказывалась старая версия без градиентов, без SRS, без категорий эпизодов и т.д.

## Золотое правило

**Для кода приложения (src/app, layout, стили, API) ветки `main` и `develop` не должны расходиться.**

По умолчанию все правки считаются для прода (сначала develop, потом полный merge в main при деплое). Если нужно что-то **только для develop** (эксперимент, не на прод) — это оговаривается отдельно.

- Всё, что уже есть на `develop` (оформление, логика, новые страницы), должно быть в `main` перед деплоем.
- **Никогда** не мержить в main «одну фичу» или один файл. Всегда мержить **весь** актуальный `develop`.

## Обязательный порядок перед каждым деплоем

1. **Закоммитить на develop всё**, что относится к приложению и деплою:
   - `src/app/**` (страницы, API, layout, TopTabs)
   - `src/app/globals.css`
   - `package.json` / `package-lock.json` при новых зависимостях
   - `deploy.md`, `vercel.json`, `scripts/testProd.ts` при изменениях
   - новые миграции в `supabase/migrations/`
   Команда: `git status` → убедиться, что нет незакоммиченных правок в этих местах.

2. **Проверить билд**: `npm run build` (должен проходить без ошибок).

3. **Мерж в main только так**:
   ```bash
   git checkout main
   git pull origin main
   git merge develop -m "Deploy: краткое описание"
   git push origin main
   git checkout develop
   ```
   Так в main попадает **весь** текущий develop.

4. **Деплой на прод (обязательно вручную каждый раз)**:
   ```bash
   git checkout main
   git pull origin main
   npx vercel --yes --prod
   ```
   Не полагаться на автодеплой по push в main — всегда вызывать `vercel --prod` после push.

5. **Проверка**: `npx tsx scripts/testProd.ts` — должен завершиться без ошибок (вкладки, Word Count, Words, Dashboard, новый UI на Words). Затем `git checkout develop`.

## Чего не делать

- Не пушить в main отдельные файлы в обход develop.
- Не мержить в main «только что добавленную фичу», оставляя остальные правки на develop.
- Не деплоить с main, не убедившись, что перед этим в main был смержен **полный** develop (`git log main -1` и `git log develop -1` — merge-коммит в main должен включать последний develop).

## Чеклист перед merge develop → main

- [ ] На develop закоммичено всё по приложению (нет нужных правок в `git status`).
- [ ] `npm run build` успешен.
- [ ] Выполнен `git merge develop` в main (не выборочный merge файлов).
- [ ] Выполнен **ручной деплой**: `npx vercel --yes --prod` (на ветке main).
- [ ] После деплоя выполнен `npx tsx scripts/testProd.ts` — тест прошёл (в т.ч. New UI на Words).
