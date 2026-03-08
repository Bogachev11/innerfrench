/**
 * Resolves canonical InnerFrench episode URLs using Podbean episode pages from RSS.
 *
 * Usage:
 *   npx tsx scripts/resolveUrls.ts
 *   npx tsx scripts/resolveUrls.ts 1 190
 */
import * as fs from "fs";
import * as path from "path";

const FEED_URL = "https://podcast.innerfrench.com/feed";
const DATA_FILE = path.join(__dirname, "data", "episodes.json");
const OUT_MAP_FILE = path.join(__dirname, "data", "url-map.json");

interface Episode {
  number: number;
  title: string;
  slug: string;
  source_url: string;
  audio_url: string;
  duration_sec: number | null;
  published_at: string | null;
}

function normalizeUrl(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "/");
}

function episodeNumberFromTitle(title: string): number | null {
  const m = title.match(/^E(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

function readTag(itemXml: string, tag: string): string {
  const cdata = itemXml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = itemXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return plain ? plain[1].trim() : "";
}

function extractInnerFrenchUrlFromPodbeanHtml(html: string): string | null {
  const candidates = [...html.matchAll(/https:\/\/innerfrench\.com\/\d+[^"'<\s]*/g)].map((m) => m[0]);
  if (candidates.length === 0) return null;
  return normalizeUrl(candidates[0].replace(/&amp;/g, "&"));
}

async function fetchPodbeanMap(): Promise<Map<number, string>> {
  const res = await fetch(FEED_URL);
  const xml = await res.text();
  const items = xml.split("<item>").slice(1);
  const map = new Map<number, string>();

  for (const item of items) {
    const title = readTag(item, "title");
    const number = episodeNumberFromTitle(title);
    if (!number) continue;
    const link = readTag(item, "link");
    if (!link) continue;
    map.set(number, link);
  }
  return map;
}

async function main() {
  const start = parseInt(process.argv[2] || "1", 10);
  const end = parseInt(process.argv[3] || "190", 10);
  const episodes: Episode[] = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  const podbeanMap = await fetchPodbeanMap();
  const byNumber = new Map<number, string>();

  for (let n = start; n <= end; n++) {
    const podbeanUrl = podbeanMap.get(n);
    if (!podbeanUrl) {
      console.log(`#${n}: no Podbean link in RSS`);
      continue;
    }

    try {
      const html = await (await fetch(podbeanUrl)).text();
      const src = extractInnerFrenchUrlFromPodbeanHtml(html);
      if (!src) {
        console.log(`#${n}: transcript URL not found in Podbean page`);
        continue;
      }
      byNumber.set(n, src);
      console.log(`#${n}: ${src}`);
    } catch {
      console.log(`#${n}: fetch failed (${podbeanUrl})`);
    }
  }

  let updated = 0;
  let resolvedInRange = 0;
  for (const ep of episodes) {
    if (ep.number < start || ep.number > end) continue;
    const found = byNumber.get(ep.number);
    if (!found) continue;
    resolvedInRange += 1;
    if (ep.source_url !== found) {
      ep.source_url = found;
      const m = found.match(/innerfrench\.com\/(.+?)\/?$/);
      if (m) ep.slug = m[1];
      updated += 1;
    }
  }

  const mapObject = Object.fromEntries(
    [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])
  );

  fs.writeFileSync(DATA_FILE, JSON.stringify(episodes, null, 2), "utf-8");
  fs.writeFileSync(OUT_MAP_FILE, JSON.stringify(mapObject, null, 2), "utf-8");

  const targetCount = episodes.filter((e) => e.number >= start && e.number <= end).length;
  console.log(`\nResolved in range: ${resolvedInRange}/${targetCount}`);
  console.log(`Updated in episodes.json: ${updated}`);
  console.log(`Saved map: ${OUT_MAP_FILE}`);
}

main().catch(console.error);
