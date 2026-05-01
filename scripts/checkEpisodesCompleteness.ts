/**
 * Compares Supabase episodes with local data files.
 * Usage: npx tsx scripts/checkEpisodesCompleteness.ts
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

function getLocalEpisodeNumbers(): number[] {
  const numbers = new Set<number>();
  if (!fs.existsSync(DATA_DIR)) return [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    const m = name.match(/^episodes_(\d+)-(\d+)\.json$/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      for (let n = start; n <= end; n++) numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

async function main() {
  const { data: dbEps, error } = await supabase
    .from("episodes")
    .select("number")
    .order("number");
  if (error) {
    console.error("Supabase error:", error.message);
    process.exit(1);
  }
  const inDb = new Set((dbEps || []).map((r) => r.number));
  const local = getLocalEpisodeNumbers();

  const missingInDb = local.filter((n) => !inDb.has(n));
  const onlyInDb = [...inDb].filter((n) => !local.includes(n)).sort((a, b) => a - b);

  console.log(`Supabase: ${inDb.size} episodes`);
  console.log(`Local data: ${local.length} episodes (episodes_X-Y.json)`);
  console.log("");
  if (missingInDb.length > 0) {
    console.log(`Missing in DB (have local file, need push): ${missingInDb.join(", ")}`);
    console.log(`  Push with: npx tsx scripts/pushToSupabase.ts scripts/data/episodes_N-N.json`);
  } else {
    console.log("All locally available episodes are in DB.");
  }
  if (onlyInDb.length > 0) {
    console.log("");
    console.log(`In DB but no local file: ${onlyInDb.length} numbers (e.g. ${onlyInDb.slice(0, 10).join(", ")}${onlyInDb.length > 10 ? "..." : ""})`);
  }
}

main().catch(console.error);
