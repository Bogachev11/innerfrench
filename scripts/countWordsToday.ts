/**
 * Сколько слов добавлено в user_words за сегодня (по UTC).
 * Запуск: npx tsx scripts/countWordsToday.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { count, error } = await supabase
    .from("user_words")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayIso);

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
  console.log(`Слов/выражений добавлено за сегодня (с 00:00 UTC): ${count ?? 0}`);
}

main().catch(console.error);
