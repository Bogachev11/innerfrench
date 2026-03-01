import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SCREENSHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const DEVICE_ID = "test-visual-preview";

async function main() {
  // Seed fake progress for visual test
  const { data: eps } = await sb.from("episodes").select("id, number, duration_sec").order("number");
  if (eps) {
    for (const ep of eps) {
      const dur = (ep.duration_sec ?? 1800) * 1000;
      let pos = 0, completed = false;
      if (ep.number === 1) { completed = true; pos = dur; }
      else if (ep.number === 2) { pos = dur * 0.6; }
      else if (ep.number === 3) { pos = dur * 0.25; }
      // rest: no progress

      if (pos > 0) {
        await sb.from("episode_progress").upsert({
          episode_id: ep.id, device_id: DEVICE_ID,
          last_position_ms: Math.round(pos), total_listened_ms: Math.round(pos),
          completed, updated_at: new Date().toISOString(),
        }, { onConflict: "episode_id,device_id" });
      }
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Set device_id in localStorage before navigating
  await page.goto("http://localhost:3001", { waitUntil: "networkidle" });
  await page.evaluate((id) => localStorage.setItem("fp_device_id", id), DEVICE_ID);

  await page.goto("http://localhost:3001/episodes", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "list_progress.png") });

  // Cleanup
  await sb.from("episode_progress").delete().eq("device_id", DEVICE_ID);
  await browser.close();
  console.log("Done");
}

main().catch(console.error);
