create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  lemma text,
  translation_ru text,
  created_at timestamptz default now()
);

create index if not exists idx_words_word on words(word);

create table if not exists user_words (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  episode_id uuid not null references episodes(id) on delete cascade,
  segment_id uuid not null references segments(id) on delete cascade,
  word text not null,
  lemma text,
  translation_ru text not null,
  context_fr text not null,
  context_ru text,
  created_at timestamptz default now(),
  unique (device_id, episode_id, segment_id, word)
);

create index if not exists idx_user_words_device on user_words(device_id);
create index if not exists idx_user_words_created on user_words(created_at);

alter table words enable row level security;
alter table user_words enable row level security;

create policy "words_read" on words for select using (true);
create policy "words_insert" on words for insert with check (true);
create policy "words_update" on words for update using (true);

create policy "user_words_read" on user_words for select using (true);
create policy "user_words_insert" on user_words for insert with check (device_id is not null);
create policy "user_words_update" on user_words for update using (true);
create policy "user_words_delete" on user_words for delete using (true);

