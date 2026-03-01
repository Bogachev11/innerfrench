import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Try RSS data first
  const rssPath = path.join(__dirname, "data", "episodes.json");
  const rssEps: any[] = JSON.parse(fs.readFileSync(rssPath, "utf-8"));
  const durMap = new Map<number, number>();
  for (const e of rssEps) {
    if (e.duration_sec) durMap.set(e.number, e.duration_sec);
  }

  const { data: dbEps } = await sb.from("episodes").select("id, number").order("number");
  if (!dbEps) return;

  for (const ep of dbEps) {
    let dur = durMap.get(ep.number);

    // Fallback: estimate from last segment end_ms
    if (!dur) {
      const { data: lastSeg } = await sb.from("segments")
        .select("start_ms, end_ms")
        .eq("episode_id", ep.id)
        .order("idx", { ascending: false })
        .limit(1)
        .single();
      if (lastSeg) {
        dur = Math.ceil((lastSeg.end_ms ?? lastSeg.start_ms) / 1000);
      }
    }

    if (dur) {
      await sb.from("episodes").update({ duration_sec: dur }).eq("id", ep.id);
      console.log(`#${ep.number} -> ${dur}s (${Math.round(dur / 60)} min)`);
    } else {
      console.log(`#${ep.number} -> no duration found`);
    }
  }
  console.log("Done");
}

main().catch(console.error);
