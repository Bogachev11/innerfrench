/**
 * Imports episodes from InnerFrench. Parses HTML (via Playwright JS execution),
 * extracts audio URL, timecoded transcript segments.
 *
 * Login NOT required — transcript is loaded via client-side JS.
 *
 * Usage:
 *   npx tsx scripts/importEpisode.ts <url>
 *   npx tsx scripts/importEpisode.ts --batch 1-10
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const OUT_DIR = path.join(__dirname, "data");
const COOKIES_FILE = path.join(OUT_DIR, ".cookies.json");

interface Segment {
  idx: number;
  start_ms: number;
  end_ms: number | null;
  fr_text: string;
}

interface EpisodeData {
  number: number;
  title: string;
  slug: string;
  source_url: string;
  audio_url: string;
  duration_sec: number | null;
  published_at: string | null;
  segments: Segment[];
}

function timeToMs(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return 0;
}

function durationToSec(dur: string): number | null {
  const parts = dur.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

async function parseEpisode(
  page: import("playwright").Page,
  url: string
): Promise<EpisodeData> {
  console.log(`Parsing: ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  const finalUrl = page.url();
  console.log(`  Landed on: ${finalUrl}`);
  await page.waitForTimeout(5000);

  // Wait for dynamic transcript content to render
  try {
    await page.waitForSelector("a.srmp3_sonaar_ts_shortcode", { timeout: 15000 });
    console.log("  Found timestamp anchors");
  } catch {
    console.log("  No timestamp anchors after wait, checking innerHTML...");
    const hasTimecodes = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const match = html.match(/srmp3_sonaar_ts_shortcode/);
      const dynamicHtml = document.querySelector('.kb-dynamic-html');
      return {
        hasClass: !!match,
        dynamicHtml: dynamicHtml ? dynamicHtml.innerHTML.substring(0, 300) : "not found",
        showMore: document.querySelector('.kb-block-show-more-container')?.innerHTML?.substring(0, 300) || "not found",
      };
    });
    console.log("  Debug:", JSON.stringify(hasTimecodes, null, 2));
  }

  const data = await page.evaluate(() => {
    // Audio metadata
    const audioEl = document.querySelector("li[data-audiopath]");
    const audioUrl = audioEl?.getAttribute("data-audiopath") || "";
    const trackTitle = audioEl?.getAttribute("data-tracktitle") || "";
    const trackTime = audioEl?.getAttribute("data-tracktime") || "";
    const trackDate = audioEl?.getAttribute("data-date") || "";

    // Title from page
    const h1 = document.querySelector("h1");
    const pageTitle = h1?.textContent?.trim() || "";

    // Transcript: sonaar timestamp anchors + text
    // Two formats:
    //   New (ep 190+): <a>[time]</a> <p>text</p> <a>[time]</a> <p>text</p>
    //   Old (ep 1-~90): <p><a>[time]</a> text <a>[time]</a> text</p>
    const anchors = document.querySelectorAll("a.srmp3_sonaar_ts_shortcode");
    const segments: { time: string; text: string }[] = [];

    for (let ai = 0; ai < anchors.length; ai++) {
      const a = anchors[ai];
      const timeMatch = a.textContent?.match(/\[(\d{2}:\d{2}:\d{2})\]/);
      if (!timeMatch) continue;

      const texts: string[] = [];

      // Format 1: text in sibling <p> elements (new format)
      let el = a.nextElementSibling;
      while (el) {
        if (el.classList.contains("srmp3_sonaar_ts_shortcode")) break;
        if (el.tagName === "A" && el.classList.contains("srmp3_sonaar_ts_shortcode")) break;
        if (el.tagName === "P" && el.textContent?.trim()) {
          texts.push(el.textContent.trim());
        }
        el = el.nextElementSibling;
      }

      // Format 2: text in text nodes after <a> within same <p> (old format)
      if (texts.length === 0) {
        let node: Node | null = a.nextSibling;
        let txt = "";
        while (node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const elem = node as Element;
            if (elem.classList?.contains("srmp3_sonaar_ts_shortcode")) break;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            txt += node.textContent || "";
          }
          node = node.nextSibling;
        }
        txt = txt.trim();
        if (txt) texts.push(txt);
      }

      if (texts.length > 0) {
        segments.push({ time: timeMatch[1], text: texts.join("\n") });
      }
    }

    return { audioUrl, trackTitle, trackTime, trackDate, pageTitle, segments };
  });

  // Use the final URL after redirects to get slug/number
  const realUrl = finalUrl || url;
  const numMatch = realUrl.match(/\/(\d+)-/);
  const number = numMatch ? parseInt(numMatch[1]) : 0;
  const slugMatch = realUrl.match(/innerfrench\.com\/(.+?)\/?$/);
  const slug = slugMatch ? slugMatch[1] : "";

  const segments: Segment[] = data.segments.map((s, i, arr) => ({
    idx: i,
    start_ms: timeToMs(s.time),
    end_ms: i < arr.length - 1 ? timeToMs(arr[i + 1].time) : null,
    fr_text: s.text,
  }));

  const title = data.pageTitle.replace(/^#\d+\s*/, "") || data.trackTitle;

  return {
    number,
    title,
    slug,
    source_url: url,
    audio_url: data.audioUrl,
    duration_sec: durationToSec(data.trackTime),
    published_at: data.trackDate ? data.trackDate.replace(/\//g, "-") : null,
    segments,
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/importEpisode.ts <url>");
    console.error("       npx tsx scripts/importEpisode.ts --batch 1-10");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!fs.existsSync(COOKIES_FILE)) {
    console.error("No saved cookies. Run 'npx tsx scripts/auth.ts' first.");
    process.exit(1);
  }
  const savedCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await context.addCookies(savedCookies);
  const page = await context.newPage();

  if (arg === "--batch") {
    const range = process.argv[3] || "1-10";
    const [start, end] = range.split("-").map(Number);
    const listPath = path.join(OUT_DIR, "episodes.json");
    if (!fs.existsSync(listPath)) {
      console.error("Run fetchEpisodeList.ts first to get episodes.json");
      process.exit(1);
    }
    const allEpisodes: { number: number; source_url: string }[] = JSON.parse(
      fs.readFileSync(listPath, "utf-8")
    );
    const toImport = allEpisodes.filter((e) => e.number >= start && e.number <= end);
    console.log(`Batch import: episodes ${start}-${end} (${toImport.length} found)\n`);

    const results: EpisodeData[] = [];
    for (const ep of toImport) {
      try {
        const data = await parseEpisode(page, ep.source_url);
        results.push(data);
        console.log(`  OK #${data.number} "${data.title}" — ${data.segments.length} segments\n`);
      } catch (e) {
        console.error(`  FAIL #${ep.number}: ${e}`);
      }
      await page.waitForTimeout(2000);
    }

    const outFile = path.join(OUT_DIR, `episodes_${start}-${end}.json`);
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\nSaved ${results.length} episodes to ${outFile}`);
  } else {
    const url = arg.startsWith("http") ? arg : `https://innerfrench.com/${arg}`;
    const data = await parseEpisode(page, url);
    const outFile = path.join(OUT_DIR, `episode_${data.number}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf-8");
    console.log(`\nSaved to ${outFile}`);
    console.log(`  Segments: ${data.segments.length}`);
    console.log(`  Audio: ${data.audio_url}`);
    console.log(`  Duration: ${data.duration_sec}s`);
  }

  await browser.close();
}

main().catch(console.error);
