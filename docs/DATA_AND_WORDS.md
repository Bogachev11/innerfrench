# Данные: слова и вкладка Words

## Где хранятся слова

- **Supabase, таблица `user_words`** — все сохранённые из плеера слова и выражения.
  - Поля: `device_id`, `episode_id`, `segment_id`, `word`, `lemma`, `translation_ru`, `context_fr`, `context_ru`, `created_at`.
  - При сохранении в плеере вызывается `supabase.from("user_words").insert(...)` (см. `EpisodePlayer.tsx`).

## Как Words получает слова и прогресс

- **Вкладка Words** (`/vocab`, `src/app/vocab/page.tsx`):
  1. **syncProgressRows**: загружает **все** строки из `user_words` (без фильтра по устройству), строит множество слов по `canonical_key`. Для каждого слова, которого ещё нет в `user_word_progress`, добавляется строка с `device_id = 'default'`.
  2. **loadDeck**: загружает из `user_word_progress` строки с `device_id = 'default'`, фильтрует по «due» и показывает карточки.
  3. **review_events**: записываются и читаются с `device_id = 'default'`.

Итог: и список слов, и прогресс по карточкам (SRS) — общие в Supabase, один пул для всех устройств. Константа `PROGRESS_DEVICE_ID = 'default'` в `vocab/page.tsx`.

## device_id в user_words

- При сохранении слова в плеере в `user_words` по-прежнему пишется `device_id` из `getDeviceId()` (localStorage). На вкладке Words при загрузке слов этот фильтр не используется — берутся все строки из `user_words`.

## При сомнениях

При изменениях логики сохранения/загрузки слов — уточнять у пользователя.
