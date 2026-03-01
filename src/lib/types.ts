export interface Episode {
  id: string;
  number: number;
  title: string;
  slug: string;
  source_url: string;
  audio_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
  created_at: string;
}

export interface Segment {
  id: string;
  episode_id: string;
  idx: number;
  start_ms: number;
  end_ms: number | null;
  fr_text: string;
  ru_text: string | null;
}

export interface EpisodeProgress {
  episode_id: string;
  device_id: string;
  last_position_ms: number;
  total_listened_ms: number;
  completed: boolean;
  updated_at: string;
}
