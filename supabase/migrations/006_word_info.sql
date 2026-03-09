create table if not exists word_info (
  canonical_key text primary key,
  grammar text,
  example_fr text,
  example_ru text,
  created_at timestamptz not null default now()
);

create index if not exists idx_word_info_canonical on word_info(canonical_key);

alter table word_info enable row level security;

create policy "word_info_select" on word_info for select using (true);
create policy "word_info_insert" on word_info for insert with check (true);
create policy "word_info_update" on word_info for update using (true);
