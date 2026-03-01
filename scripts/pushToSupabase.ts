/**
 * Pushes scraped episode data to Supabase via REST API (service_role key).
 * Also runs schema migration if tables don't exist.
 *
 * Usage: npx tsx scripts/pushToSupabase.ts [file]
 *   Default file: scripts/data/episodes_1-10.json
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SegmentData {
  idx: number;
  start_ms: number;
  end_ms: number | null;
  fr_text: string;
}

interface EpisodeData {
  number: number;
  title: string;
  slug: string;
  source_url: string;
  audio_url: string;
  duration_sec: number | null;
  published_at: string | null;
  segments: SegmentData[];
}

async function ensureSchema() {
  // Check if episodes table exists by trying a query
  const { error } = await supabase.from("episodes").select("id").limit(1);
  if (error && error.message.includes("does not exist")) {
    console.log("Tables don't exist. Please run the migration SQL manually:");
    console.log("  1. Go to Supabase Dashboard → SQL Editor");
    console.log("  2. Paste contents of supabase/migrations/001_schema.sql");
    console.log("  3. Click Run");
    process.exit(1);
  }
  return !error;
}

async function pushEpisode(ep: EpisodeData) {
  // Upsert episode
  const { data: epRow, error: epErr } = await supabase
    .from("episodes")
    .upsert(
      {
        number: ep.number,
        title: ep.title,
        slug: ep.slug,
        source_url: ep.source_url,
        audio_url: ep.audio_url,
        duration_sec: ep.duration_sec,
        published_at: ep.published_at,
      },
      { onConflict: "number" }
    )
    .select("id")
    .single();

  if (epErr) {
    console.error(`  Episode #${ep.number} error: ${epErr.message}`);
    return;
  }

  const episodeId = epRow.id;

  // Upsert segments
  if (ep.segments.length > 0) {
    // Delete existing segments first (simpler than upserting)
    await supabase.from("segments").delete().eq("episode_id", episodeId);

    const segRows = ep.segments.map((s) => ({
      episode_id: episodeId,
      idx: s.idx,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      fr_text: s.fr_text,
    }));

    const { error: segErr } = await supabase.from("segments").insert(segRows);
    if (segErr) {
      console.error(`  Segments error: ${segErr.message}`);
      return;
    }
  }

  console.log(`  #${ep.number} "${ep.title}" — ${ep.segments.length} segments → OK`);
}

async function main() {
  const file = process.argv[2] || path.join(__dirname, "data", "episodes_1-10.json");

  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const episodes: EpisodeData[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Pushing ${episodes.length} episodes to Supabase...\n`);

  const ok = await ensureSchema();
  if (!ok) return;

  for (const ep of episodes) {
    await pushEpisode(ep);
  }

  console.log("\nDone!");
}

main().catch(console.error);
