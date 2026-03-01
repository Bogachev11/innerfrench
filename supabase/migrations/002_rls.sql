-- Enable RLS on all tables
alter table episodes enable row level security;
alter table segments enable row level security;
alter table episode_progress enable row level security;
alter table listening_sessions enable row level security;

-- Episodes: public read
create policy "episodes_read" on episodes for select using (true);

-- Segments: public read
create policy "segments_read" on segments for select using (true);

-- Episode progress: public read/write (MVP, device_id based)
create policy "progress_read" on episode_progress for select using (true);
create policy "progress_insert" on episode_progress for insert with check (true);
create policy "progress_update" on episode_progress for update using (true);

-- Listening sessions: public insert + read own
create policy "sessions_insert" on listening_sessions for insert with check (true);
create policy "sessions_read" on listening_sessions for select using (true);
create policy "sessions_update" on listening_sessions for update using (true);
