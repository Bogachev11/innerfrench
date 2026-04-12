#!/usr/bin/env node
/**
 * Compute per-episode stats and write to public/ep-stats.json
 * Run: node scripts/compute-ep-stats.cjs
 *
 * Stats per episode (processed in number order, building cumulative vocab):
 *   totalWords    — total word tokens
 *   uniqueForms   — unique word forms
 *   newForms      — forms not seen in any prior episode (proper nouns excluded)
 *   wordsPerMin   — words per minute
 *   segmentSpeeds — bucketed ch/min array (24 buckets) for speed chart
 */

const path = require("path");
const { config } = require("dotenv");
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HEADERS = { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY };
const PAGE = 1000;
const BUCKETS = 24;

async function get(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function tokenize(text) {
  return (text || "").toLowerCase().match(/[a-zàâçéèêëîïôùûüÿœæ'-]+/g) || [];
}

/** Return a Set of tokens that appear with capital letter in non-sentence-start positions.
 *  These are likely proper nouns (names, places). */
function detectProperNouns(texts) {
  const properNouns = new Set();
  // Regex: word with initial capital that is NOT preceded by [.!?] + whitespace
  const re = /(?<![.!?…]\s)(?<!\n)\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜŒÆ][a-zàâçéèêëîïôùûüÿœæ'-]{1,})\b/g;
  for (const text of texts) {
    let m;
    while ((m = re.exec(text)) !== null) {
      properNouns.add(m[1].toLowerCase());
    }
  }
  return properNouns;
}

async function main() {
  console.log("Fetching episodes...");
  const episodes = await get(`${SUPABASE_URL}/rest/v1/episodes?select=id,number,duration_sec&order=number.asc&limit=500`);
  console.log(`  ${episodes.length} episodes`);

  // Get total segment count
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/segments?select=*`, {
    method: "HEAD",
    headers: { ...HEADERS, Prefer: "count=exact" },
  });
  const contentRange = countRes.headers.get("content-range");
  const total = parseInt(contentRange.split("/")[1]);
  console.log(`Fetching ${total} segments in ${Math.ceil(total / PAGE)} pages...`);

  const pageRequests = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) =>
    get(`${SUPABASE_URL}/rest/v1/segments?select=episode_id,fr_text,start_ms,end_ms&order=episode_id.asc,idx.asc&offset=${i * PAGE}&limit=${PAGE}`)
  );
  const pages = await Promise.all(pageRequests);
  const allSegs = pages.flat();
  console.log(`  Got ${allSegs.length} segments`);

  // Group by episode
  const segsByEp = new Map();
  for (const s of allSegs) {
    if (!segsByEp.has(s.episode_id)) segsByEp.set(s.episode_id, []);
    segsByEp.get(s.episode_id).push(s);
  }

  // Build proper noun set from ALL text (to exclude across all episodes)
  console.log("Detecting proper nouns...");
  const allTexts = allSegs.map(s => s.fr_text || "");
  const properNouns = detectProperNouns(allTexts);
  console.log(`  ${properNouns.size} proper nouns detected`);

  // Process episodes in number order, building cumulative vocab
  const sorted = [...episodes].sort((a, b) => a.number - b.number);
  const cumulativeVocab = new Set();
  const stats = {};

  for (const ep of sorted) {
    const segs = segsByEp.get(ep.id) || [];
    const texts = segs.map(s => s.fr_text || "");
    const text = texts.join(" ");
    if (!text.trim()) continue;

    const tokens = tokenize(text).filter(t => !properNouns.has(t));
    const unique = new Set(tokens);
    const newForms = [...unique].filter(t => !cumulativeVocab.has(t)).length;
    tokens.forEach(t => cumulativeVocab.add(t));

    // Speed chart
    const rawSpeeds = segs
      .filter(s => s.start_ms != null && s.end_ms != null && s.end_ms > s.start_ms)
      .map(s => (s.fr_text || "").replace(/\s+/g, "").length / ((s.end_ms - s.start_ms) / 60000));
    const bSize = Math.max(1, Math.ceil(rawSpeeds.length / BUCKETS));
    const segmentSpeeds = [];
    for (let i = 0; i < rawSpeeds.length; i += bSize) {
      const chunk = rawSpeeds.slice(i, i + bSize);
      segmentSpeeds.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
    }

    // All word count (including proper nouns) for totalWords/uniqueForms/wordsPerMin
    const allTokens = tokenize(text);
    stats[ep.id] = {
      totalWords: allTokens.length,
      uniqueForms: new Set(allTokens).size,
      newForms,
      wordsPerMin: ep.duration_sec ? Math.round(allTokens.length / (ep.duration_sec / 60)) : null,
      segmentSpeeds,
    };
  }

  const outPath = path.resolve(__dirname, "..", "public", "ep-stats.json");
  require("fs").writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    episodeCount: episodes.length,
    stats,
  }));
  console.log(`\nWrote ${Object.keys(stats).length} episodes to public/ep-stats.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
