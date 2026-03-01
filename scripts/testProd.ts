import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const BASE = "https://20260301frenchpodcasttool.vercel.app";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  console.log("1. Episodes list...");
  await page.goto(`${BASE}/episodes`, { waitUntil: "networkidle", timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_01_episodes.png") });
  const epCount = await page.locator("a[href^='/episodes/']").count();
  console.log(`   ${epCount} episodes`);

  console.log("2. Player...");
  await page.goto(`${BASE}/episodes/01-learn-french-naturally`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_02_player.png") });
  const segs = await page.locator(".grid.grid-cols-2").count();
  console.log(`   ${segs} segments`);

  console.log("3. Dashboard...");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_03_dashboard.png") });

  await browser.close();
  console.log("Done!");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
