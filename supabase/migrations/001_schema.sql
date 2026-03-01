-- Episodes table
create table episodes (
  id uuid primary key default gen_random_uuid(),
  number int unique not null,
  title text not null,
  slug text unique not null,
  source_url text not null,
  audio_url text,
  duration_sec int,
  published_at date,
  created_at timestamptz default now()
);

-- Transcript segments
create table segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  idx int not null,
  start_ms int not null,
  end_ms int,
  fr_text text not null,
  ru_text text,
  created_at timestamptz default now(),
  unique (episode_id, idx)
);
create index idx_segments_episode on segments(episode_id);

-- Episode progress per device
create table episode_progress (
  episode_id uuid not null references episodes(id) on delete cascade,
  device_id text not null,
  last_position_ms int default 0,
  total_listened_ms int default 0,
  completed boolean default false,
  updated_at timestamptz default now(),
  primary key (episode_id, device_id)
);

-- Listening sessions
create table listening_sessions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  device_id text not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  listened_ms int default 0,
  start_position_ms int default 0,
  end_position_ms int default 0
);
create index idx_sessions_device on listening_sessions(device_id);
create index idx_sessions_episode on listening_sessions(episode_id);
