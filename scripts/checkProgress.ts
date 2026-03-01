import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: progress } = await sb.from("episode_progress").select("*");
  console.log("episode_progress rows:", progress?.length ?? 0);
  progress?.forEach((p) => console.log(p));

  const { data: sessions } = await sb.from("listening_sessions").select("*");
  console.log("\nlistening_sessions rows:", sessions?.length ?? 0);
  sessions?.forEach((s) => console.log(s));
}
main();
