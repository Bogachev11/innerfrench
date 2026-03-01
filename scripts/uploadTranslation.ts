/**
 * Upload Russian translations for an episode.
 * Usage: npx tsx scripts/uploadTranslation.ts <episode_number> <path_to_json>
 * JSON format: [{ "idx": 0, "ru_text": "..." }, ...]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const [, , numStr, jsonPath] = process.argv;
  if (!numStr || !jsonPath) {
    console.log("Usage: npx tsx scripts/uploadTranslation.ts <episode_number> <json_file>");
    console.log('JSON: [{ "idx": 0, "ru_text": "Текст перевода" }, ...]');
    process.exit(1);
  }

  const epNum = parseInt(numStr, 10);
  const translations: { idx: number; ru_text: string }[] = JSON.parse(
    fs.readFileSync(jsonPath, "utf-8")
  );

  const { data: ep } = await supabase
    .from("episodes")
    .select("id, title")
    .eq("number", epNum)
    .single();

  if (!ep) {
    console.error(`Episode #${epNum} not found`);
    process.exit(1);
  }

  console.log(`Uploading ${translations.length} translations for #${epNum} "${ep.title}"...`);

  let ok = 0;
  for (const t of translations) {
    const { error } = await supabase
      .from("segments")
      .update({ ru_text: t.ru_text })
      .eq("episode_id", ep.id)
      .eq("idx", t.idx);
    if (error) {
      console.error(`  idx ${t.idx}: ${error.message}`);
    } else {
      ok++;
    }
  }

  console.log(`Done: ${ok}/${translations.length} updated`);
}

main().catch(console.error);
