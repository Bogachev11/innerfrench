/**
 * Auto-translate all segments without ru_text using Google Translate free endpoint.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function translate(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const json = await res.json();
  return (json[0] as [string, string][]).map((s) => s[0]).join("");
}

async function main() {
  const { data: segments, error } = await supabase
    .from("segments")
    .select("id, fr_text, episode_id")
    .is("ru_text", null)
    .order("episode_id")
    .order("idx");

  if (error) {
    console.error("Fetch error:", error.message);
    process.exit(1);
  }

  console.log(`${segments.length} segments to translate\n`);

  let done = 0;
  let currentEp = "";

  for (const seg of segments) {
    if (seg.episode_id !== currentEp) {
      currentEp = seg.episode_id;
      const { data: ep } = await supabase.from("episodes").select("number, title").eq("id", currentEp).single();
      console.log(`\n#${ep?.number} ${ep?.title}`);
    }

    try {
      const ru = await translate(seg.fr_text);
      await supabase.from("segments").update({ ru_text: ru }).eq("id", seg.id);
      done++;
      process.stdout.write(".");
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      console.error(`\n  ERR (${seg.id}): ${e.message}`);
    }
  }

  console.log(`\n\nDone: ${done}/${segments.length} translated`);
}

main().catch(console.error);
