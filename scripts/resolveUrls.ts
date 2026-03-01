/**
 * Resolves real innerfrench.com URLs for episodes by trying multiple patterns.
 * Usage: npx tsx scripts/resolveUrls.ts [start] [end]
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const DATA_FILE = path.join(__dirname, "data", "episodes.json");
const COOKIES_FILE = path.join(__dirname, "data", ".cookies.json");

function candidateUrls(n: number): string[] {
  const padded = n.toString().padStart(2, "0");
  return [
    `https://innerfrench.com/e${padded}`,
    `https://innerfrench.com/e${n}`,
    `https://innerfrench.com/${padded}`,
    `https://innerfrench.com/${n}`,
  ];
}

async function main() {
  const start = parseInt(process.argv[2] || "1");
  const end = parseInt(process.argv[3] || "10");

  const episodes = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  for (const ep of episodes) {
    if (ep.number < start || ep.number > end) continue;

    const urls = candidateUrls(ep.number);
    let found = false;

    for (const tryUrl of urls) {
      try {
        const resp = await page.goto(tryUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
        const finalUrl = page.url();
        const status = resp?.status() || 0;

        // Check this is actually the right episode (page has ep number in title)
        if (status === 200 && !finalUrl.includes("404")) {
          const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent || "");
          const numInTitle = h1.match(/#(\d+)/);

          if (numInTitle && parseInt(numInTitle[1]) === ep.number) {
            const match = finalUrl.match(/innerfrench\.com\/(.+?)\/?$/);
            if (match) {
              ep.slug = match[1];
              ep.source_url = `https://innerfrench.com/${match[1]}`;
              console.log(`  #${ep.number}: ${ep.source_url} (via ${tryUrl})`);
              found = true;
              break;
            }
          }
        }
      } catch {}
      await page.waitForTimeout(500);
    }

    if (!found) console.log(`  #${ep.number}: NOT FOUND`);
    await page.waitForTimeout(1000);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(episodes, null, 2), "utf-8");
  console.log("\nUpdated episodes.json");
  await browser.close();
}

main().catch(console.error);
