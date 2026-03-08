import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const BASE = process.env.PROD_URL || "https://innerfrench.bogachev.fr";
const timeout = 25000;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors: string[] = [];

  console.log("1. Home -> Episodes...");
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout });
  await page.goto(`${BASE}/episodes`, { waitUntil: "networkidle", timeout });
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_01_episodes.png") });
  const epCount = await page.locator("a[href^='/episodes/']").count();
  console.log(`   Episodes: ${epCount}`);

  console.log("2. TopTabs: 4 tabs (Episodes, Progress, Words, Word Count)...");
  const tabWords = page.locator('a[href="/vocab"]');
  const tabWordCount = page.locator('a[href="/word-count"]');
  const hasWords = (await tabWords.count()) > 0;
  const hasWordCount = (await tabWordCount.count()) > 0;
  if (!hasWords) errors.push("Missing tab Words");
  if (!hasWordCount) errors.push("Missing tab Word Count");
  console.log(`   Words tab: ${hasWords}, Word Count tab: ${hasWordCount}`);

  console.log("3. Word Count page...");
  await page.goto(`${BASE}/word-count`, { waitUntil: "networkidle", timeout });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_word_count.png") });
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const hasTotalForms = (await page.locator("text=Total word forms").count()) > 0;
  const hasNoData = (await page.locator("text=No data yet").count()) > 0;
  const hasLoading = (await page.locator("text=Loading...").count()) > 0;
  const ok = h1?.includes("Word Count") && (hasTotalForms || hasNoData || hasLoading);
  if (!ok) errors.push("Word Count page: expected title and (Total word forms | No data | Loading)");
  console.log(`   Title: ${h1?.trim()}, Total word forms: ${hasTotalForms}, No data: ${hasNoData}`);

  console.log("4. Dashboard...");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_03_dashboard.png") });
  const has190 = (await page.locator("text=All Episodes (1-190)").count()) > 0;
  const hasProgress = (await page.locator("text=Total Minutes").count()) > 0;
  const dashLoading = (await page.locator("text=Loading").count()) > 0;
  const dashboardOk = has190 || hasProgress || (await page.locator("main").count() > 0 && !dashLoading);
  if (!dashboardOk) errors.push("Dashboard: expected content");
  console.log(`   Dashboard OK: ${dashboardOk}`);

  console.log("5. Words (vocab) page...");
  await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle", timeout });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "prod_vocab.png") });
  const vocabTitle = await page.locator("h1").first().textContent().catch(() => "");
  const hasVocab = vocabTitle && /word|vocab|vocabulary/i.test(vocabTitle);
  if (!hasVocab) errors.push("Vocab page: expected Words/Vocabulary title");
  console.log(`   Vocab title: ${vocabTitle?.trim()}`);

  await browser.close();

  if (errors.length > 0) {
    console.error("FAIL:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }
  console.log("Done. Prod OK.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
