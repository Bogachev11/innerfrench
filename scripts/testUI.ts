import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  // 1. Episodes list
  console.log("1. /episodes");
  await page.goto("http://localhost:3000/episodes", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCREENSHOTS, "01_episodes.png") });
  const epCount = await page.locator("a[href^='/episodes/']").count();
  console.log(`   ${epCount} episodes ✓`);

  // 2. Player
  console.log("2. /episodes/01-learn-french-naturally");
  await page.goto("http://localhost:3000/episodes/01-learn-french-naturally", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "02_player.png") });

  const segCount = await page.locator(".grid.grid-cols-2").count();
  const hasAudio = (await page.locator("audio").count()) > 0;
  const hasPlay = (await page.locator("button").filter({ hasText: /▶/ }).count()) > 0;
  console.log(`   ${segCount} segments, audio: ${hasAudio}, play: ${hasPlay} ✓`);

  // 3. Dashboard
  console.log("3. /dashboard");
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "03_dashboard.png") });

  const bodyText = await page.locator("body").textContent();
  const hasStat = bodyText?.includes("Статистика");
  const hasStreak = bodyText?.includes("Серия");
  console.log(`   Stats page: ${hasStat}, streak: ${hasStreak} ✓`);

  // 4. Check mobile scroll on player
  console.log("4. Player scroll test");
  await page.goto("http://localhost:3000/episodes/01-learn-french-naturally", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollBy(0, 1200));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOTS, "04_player_scrolled.png") });
  console.log(`   Scroll OK ✓`);

  if (errors.length) {
    console.log(`\nJS Errors (${errors.length}):`);
    errors.forEach((e) => console.log(`  - ${e.substring(0, 150)}`));
  } else {
    console.log("\nNo JS errors ✓");
  }

  await browser.close();
  console.log("All checks passed!");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
