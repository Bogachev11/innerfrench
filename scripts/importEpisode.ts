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
  await page.waitForTimeout(3000);

  // Open transcript: click "Lire la transcription" then "Voir plus" if present
  const transLink = await page.locator('a[href*="#transcription"], a:has-text("transcription")').first();
  if (await transLink.count() > 0) {
    await transLink.click();
    await page.waitForTimeout(1500);
  }
  const voirPlus = page.locator('text=Voir plus, button:has-text("Voir plus"), a:has-text("Voir plus"), [class*="show-more"]');
  if (await voirPlus.count() > 0) {
    await voirPlus.first().click();
    await page.waitForTimeout(2000);
  }

  try {
    await page.waitForSelector("a.srmp3_sonaar_ts_shortcode", { timeout: 10000 });
    console.log("  Found timestamp anchors");
  } catch {
    console.log("  No timestamp anchors, will try fallback regex on body");
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
    // Formats: a.srmp3_sonaar_ts_shortcode (new) OR fallback: regex on #transcription section (old ep 14 etc.)
    const anchors = document.querySelectorAll("a.srmp3_sonaar_ts_shortcode");
    let segments: { time: string; text: string }[] = [];

    for (let ai = 0; ai < anchors.length; ai++) {
      const a = anchors[ai];
      const timeMatch = a.textContent?.match(/\[(\d{2}:\d{2}:\d{2})\]/);
      if (!timeMatch) continue;

      const texts: string[] = [];
      let el = a.nextElementSibling;
      while (el) {
        if (el.classList.contains("srmp3_sonaar_ts_shortcode")) break;
        if (el.tagName === "A" && el.classList.contains("srmp3_sonaar_ts_shortcode")) break;
        if (el.tagName === "P" && el.textContent?.trim()) {
          texts.push(el.textContent.trim());
        }
        el = el.nextElementSibling;
      }
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

    // Fallback: any element with [HH:MM:SS] (e.g. old ep 14 — links without class or transcript in body)
    if (segments.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="sonaar"], a[href*="time"]');
      for (const a of allLinks) {
        const timeMatch = a.textContent?.match(/\[(\d{2}:\d{2}:\d{2})\]/);
        if (!timeMatch) continue;
        let text = "";
        let node: Node | null = a.nextSibling;
        while (node) {
          if (node.nodeType === Node.ELEMENT_NODE && (node as Element).querySelector?.("a[href*='sonaar'], a[href*='time']")) break;
          if (node.nodeType === Node.TEXT_NODE) text += node.textContent || "";
          if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== "A") text += (node as Element).textContent || "";
          node = node.nextSibling;
        }
        text = text.replace(/\s+/g, " ").trim();
        if (text.length > 3) segments.push({ time: timeMatch[1], text });
      }
    }
    if (segments.length === 0) {
      const raw = document.body.innerText || document.body.textContent || "";
      const timeRegex = /\[(\d{2}:\d{2}:\d{2})\]\s*([\s\S]*?)(?=\[\d{2}:\d{2}:\d{2}\]|$)/g;
      let m: RegExpExecArray | null;
      while ((m = timeRegex.exec(raw)) !== null) {
        const text = m[2].replace(/\s+/g, " ").trim();
        if (text && text.length > 5) segments.push({ time: m[1], text });
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
