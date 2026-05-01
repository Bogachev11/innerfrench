/**
 * Upserts episodes from scripts/data/episodes.json (from RSS) into Supabase.
 * Use after fetchEpisodeList.ts to add missing episodes (e.g. #21).
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

const dataPath = path.join(__dirname, "data", "episodes.json");

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.log("Run fetchEpisodeList.ts first to create data/episodes.json");
    return;
  }
  const episodes: Array<{ number: number; title: string; slug: string; source_url?: string; audio_url?: string; duration_sec?: number; published_at?: string }> =
    JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Upserting ${episodes.length} episodes from RSS (including #21)...`);
  for (const ep of episodes) {
    const { error } = await supabase
      .from("episodes")
      .upsert(
        {
          number: ep.number,
          title: ep.title,
          slug: ep.slug,
          source_url: ep.source_url ?? null,
          audio_url: ep.audio_url ?? null,
          duration_sec: ep.duration_sec ?? null,
          published_at: ep.published_at ?? null,
        },
        { onConflict: "number" }
      );
    if (error) console.error(`#${ep.number}:`, error.message);
    else console.log(`  #${ep.number} ${ep.title}`);
  }
  console.log("Done.");
}

main().catch(console.error);
