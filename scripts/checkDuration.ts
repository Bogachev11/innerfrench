import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from("episodes").select("number, duration_sec").order("number");
  data?.forEach((e) => console.log(`#${e.number} duration_sec=${e.duration_sec}`));
}
main();
