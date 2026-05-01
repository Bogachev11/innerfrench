-- Optional extra translations for cards (1–3 meanings)
alter table user_words
  add column if not exists translation_ru_2 text,
  add column if not exists translation_ru_3 text;

alter table user_word_progress
  add column if not exists translation_ru_2 text,
  add column if not exists translation_ru_3 text;
