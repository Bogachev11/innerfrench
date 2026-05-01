/**
 * Pushes all episodes that exist locally but are missing in Supabase.
 * Usage: npx tsx scripts/pushMissingEpisodes.ts
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

const DATA_DIR = path.join(__dirname, "data");

async function main() {
  const { data: dbEps } = await supabase.from("episodes").select("number");
  const inDb = new Set((dbEps || []).map((r) => r.number));

  const missing: number[] = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    const m = name.match(/^episodes_(\d+)-(\d+)\.json$/);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    for (let n = start; n <= end; n++) {
      if (!inDb.has(n)) missing.push(n);
    }
  }
  missing.sort((a, b) => a - b);
  const unique = [...new Set(missing)];

  if (unique.length === 0) {
    console.log("All local episodes are already in Supabase.");
    return;
  }
  console.log(`Pushing ${unique.length} missing episodes: ${unique.join(", ")}\n`);

  for (const n of unique) {
    const file = path.join(DATA_DIR, `episodes_${n}-${n}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  #${n}: no file ${file}, skip`);
      continue;
    }
    const episodes = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const ep of episodes) {
      const { data: existing } = await supabase
        .from("episodes")
        .select("duration_sec")
        .eq("number", ep.number)
        .maybeSingle();
      const safeDuration = ep.duration_sec ?? existing?.duration_sec ?? null;
      const { data: epRow, error: epErr } = await supabase
        .from("episodes")
        .upsert(
          {
            number: ep.number,
            title: ep.title,
            slug: ep.slug,
            source_url: ep.source_url,
            audio_url: ep.audio_url,
            duration_sec: safeDuration,
            published_at: ep.published_at,
          },
          { onConflict: "number" }
        )
        .select("id")
        .single();
      if (epErr) {
        console.log(`  #${ep.number} error: ${epErr.message}`);
        continue;
      }
      if (ep.segments?.length > 0) {
        await supabase.from("segments").delete().eq("episode_id", epRow.id);
        const segRows = ep.segments.map((s: { idx: number; start_ms: number; end_ms: number | null; fr_text: string }) => ({
          episode_id: epRow.id,
          idx: s.idx,
          start_ms: s.start_ms,
          end_ms: s.end_ms,
          fr_text: s.fr_text,
        }));
        await supabase.from("segments").insert(segRows);
      }
      console.log(`  #${ep.number} "${ep.title}" — ${ep.segments?.length ?? 0} segments OK`);
    }
  }
  console.log("\nDone.");
}

main().catch(console.error);
