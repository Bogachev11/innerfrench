/**
 * Fetches all episodes from the InnerFrench Podbean RSS feed.
 * No cookies/login needed.
 * Output: scripts/data/episodes.json
 */
import * as fs from "fs";
import * as path from "path";

const FEED_URL = "https://podcast.innerfrench.com/feed";
const OUT_DIR = path.join(__dirname, "data");

interface EpEntry {
  number: number;
  title: string;
  slug: string;
  source_url: string;
  audio_url: string;
  duration_sec: number | null;
  published_at: string | null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Fetching RSS feed...");
  const res = await fetch(FEED_URL);
  const xml = await res.text();
  console.log(`  Feed: ${xml.length} chars`);

  const episodes: EpEntry[] = [];

  // Parse each <item> from the RSS
  const items = xml.split("<item>").slice(1);
  console.log(`  Items in feed: ${items.length}`);

  for (const item of items) {
    const get = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (m) return m[1].trim();
      const m2 = item.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m2 ? m2[1].trim() : "";
    };

    const title = get("title");
    // Extract episode number from title like "E191 S'ennuyer..."
    const numMatch = title.match(/^E(\d+)\s+/);
    if (!numMatch) continue;

    const number = parseInt(numMatch[1]);
    const cleanTitle = title.replace(/^E\d+\s+/, "");

    // Audio URL from <enclosure>
    const encMatch = item.match(/url="([^"]+\.mp3[^"]*)"/);
    const audioUrl = encMatch ? encMatch[1] : "";

    // Duration in seconds from <itunes:duration>
    const durMatch = item.match(/<itunes:duration>(\d+)<\/itunes:duration>/);
    const durationSec = durMatch ? parseInt(durMatch[1]) : null;

    // Published date
    const pubDate = get("pubDate");
    let publishedAt: string | null = null;
    if (pubDate) {
      try {
        publishedAt = new Date(pubDate).toISOString().split("T")[0];
      } catch {}
    }

    // Podbean URL (has the slug in it)
    const podbeanLink = item.match(/<link>(https:\/\/podcast\.innerfrench\.com\/e\/[^<]+)<\/link>/);
    const podbeanUrl = podbeanLink ? podbeanLink[1].trim() : "";

    // Extract slug from podbean URL: /e/e191-sennuyer-au-travail.../  →  191-sennuyer-au-travail...
    const pbSlug = podbeanUrl.match(/\/e\/e?\d*-?(.+?)\/?$/);

    // Build innerfrench.com URL from podbean slug
    // Podbean: podcast.innerfrench.com/e/e191-sennuyer-au-travail-le-secret-du-bonheur/
    // Site:    innerfrench.com/191-sennuyer-au-travail-le-secret-du-bonheur/
    const podbeanPath = podbeanUrl.match(/\/e\/(e\d+-(.+?))\/?$/);
    const slug = podbeanPath
      ? `${number}-${podbeanPath[2]}`
      : `${number}`;
    const sourceUrl = `https://innerfrench.com/${slug}`;

    episodes.push({
      number,
      title: cleanTitle,
      slug,
      source_url: sourceUrl,
      audio_url: audioUrl,
      duration_sec: durationSec,
      published_at: publishedAt,
    });
  }

  const sorted = episodes.sort((a, b) => a.number - b.number);

  fs.writeFileSync(
    path.join(OUT_DIR, "episodes.json"),
    JSON.stringify(sorted, null, 2),
    "utf-8"
  );
  console.log(`\nSaved ${sorted.length} episodes`);
  if (sorted.length > 0) {
    console.log(`  First: #${sorted[0].number} "${sorted[0].title}"`);
    console.log(`  Last:  #${sorted[sorted.length - 1].number} "${sorted[sorted.length - 1].title}"`);
  }
}

main().catch(console.error);
