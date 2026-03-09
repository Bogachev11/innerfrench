create table if not exists review_events (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  canonical_key text not null,
  reviewed_at timestamptz not null default now(),
  correct boolean not null
);

create index if not exists idx_review_events_device_time on review_events(device_id, reviewed_at);
create index if not exists idx_review_events_canonical on review_events(canonical_key, reviewed_at);

alter table review_events enable row level security;

create policy "review_events_select" on review_events for select using (true);
create policy "review_events_insert" on review_events for insert with check (true);
