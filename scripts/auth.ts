/**
 * Opens a visible browser for manual Cloudflare challenge + InnerFrench login.
 * Saves session cookies for reuse by importEpisode.ts.
 *
 * Usage: npx tsx scripts/auth.ts
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const COOKIES_FILE = path.join(__dirname, "data", ".cookies.json");
const EP_URL = "https://innerfrench.com/190-mon-secret-pour-aller-bien-en-2026/";

async function main() {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

  console.log("Opening browser...");
  console.log("1. Pass the Cloudflare check");
  console.log("2. Log in to InnerFrench");
  console.log("3. Scroll down to Transcription and click 'Voir plus'");
  console.log("4. Script will auto-detect and save cookies\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(EP_URL);

  let found = false;
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(2000);
    try {
      const status = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const hasTimestamps = html.includes("srmp3_sonaar_ts_shortcode");
        const hasAdminBar = html.includes("wp-admin-bar");
        const hasLogout = html.includes("logout") || html.includes("log-out");
        const url = window.location.href;
        return { hasTimestamps, hasAdminBar, hasLogout, url };
      });

      if (status.hasTimestamps) {
        found = true;
        console.log("\nTranscript with timestamps detected!");
        break;
      }

      // If logged in but no timestamps, try reloading
      if (status.hasAdminBar || status.hasLogout) {
        console.log("  Logged in detected, reloading page...");
        await page.goto(EP_URL, { waitUntil: "load" });
        await page.waitForTimeout(5000);

        // Try clicking Voir plus
        try {
          const btn = page.locator("text=Voir plus").first();
          if (await btn.isVisible({ timeout: 3000 })) {
            await btn.click();
            console.log("  Clicked 'Voir plus'");
            await page.waitForTimeout(3000);
          }
        } catch {}

        const recheck = await page.evaluate(() =>
          document.body.innerHTML.includes("srmp3_sonaar_ts_shortcode")
        );
        if (recheck) {
          found = true;
          console.log("\nTranscript with timestamps detected after reload!");
          break;
        }
      }
    } catch {}
    if (i % 15 === 0 && i > 0) console.log(`  Still waiting... (${i * 2}s)`);
  }

  if (found) {
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`Saved ${cookies.length} cookies to ${COOKIES_FILE}`);
    console.log("\nYou can now close the browser (Ctrl+C) and run:");
    console.log("  npx tsx scripts/importEpisode.ts --batch 1-10");
  } else {
    console.log("\nTimeout. Try scrolling to the transcript and clicking 'Voir plus'.");
    // Save cookies anyway in case login worked
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`Saved ${cookies.length} cookies anyway.`);
  }

  console.log("\nPress Ctrl+C to close...");
  await page.waitForTimeout(600000);
  await browser.close();
}

main().catch(console.error);
