create table if not exists user_word_progress (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  canonical_key text not null,
  display_word text not null,
  lemma text,
  translation_ru text,
  correct_count int not null default 0,
  correct_days int not null default 0,
  last_correct_day date,
  last_reviewed_at timestamptz,
  next_review_at timestamptz not null default now(),
  mastered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, canonical_key)
);

create index if not exists idx_user_word_progress_device on user_word_progress(device_id);
create index if not exists idx_user_word_progress_due on user_word_progress(device_id, next_review_at);
create index if not exists idx_user_word_progress_mastered on user_word_progress(device_id, mastered_at);

alter table user_word_progress enable row level security;

create policy "user_word_progress_read" on user_word_progress for select using (true);
create policy "user_word_progress_insert" on user_word_progress for insert with check (device_id is not null);
create policy "user_word_progress_update" on user_word_progress for update using (true);
create policy "user_word_progress_delete" on user_word_progress for delete using (true);

