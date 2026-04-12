#!/usr/bin/env node
/**
 * Compute per-episode stats and write to public/ep-stats.json
 * Run: node scripts/compute-ep-stats.cjs
 *
 * Stats per episode (processed in number order, building cumulative vocab):
 *   totalWords    — total word tokens
 *   uniqueLemmas  — unique lemmas (French words only, via LEFFF)
 *   newLemmas     — lemmas not seen in any prior episode
 *   wordsPerMin   — words per minute
 *   segmentSpeeds — bucketed ch/min array (24 buckets) for speed chart
 *
 * Field names in JSON kept as uniqueForms/newForms for back-compat with EpisodeList.
 */

const path = require("path");
const { config } = require("dotenv");
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HEADERS = { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY };
const PAGE = 1000;
const BUCKETS = 24;

// French diacritics — if a word has these it's almost certainly French
const FRENCH_DIACRITIC_RE = /[àâçéèêëîïôùûüÿœæ]/;

async function get(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function tokenize(text) {
  // Keep apostrophes inside words (l'eau → l', eau), split on everything else
  return (text || "").toLowerCase().match(/[a-zàâçéèêëîïôùûüÿœæ'-]+/g) || [];
}

/** Return a Set of tokens that appear with capital letter in non-sentence-start positions. */
function detectProperNouns(texts) {
  const properNouns = new Set();
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
  // Load LEFFF French morphological dictionary
  process.stdout.write("Loading LEFFF dictionary... ");
  const nodeLefff = require("node-lefff");
  const lefff = await nodeLefff.load();
  const lefffMlex = lefff.getLefffMlex();
  console.log(`${Object.keys(lefffMlex).length} entries`);

  // Helper: get lemma for a token (returns null if token is non-French)
  function getLemma(token) {
    // Skip very short tokens and contractions
    if (token.length < 2) return null;
    // Strip leading/trailing hyphens and apostrophes
    const clean = token.replace(/^[-']+|[-']+$/g, "");
    if (clean.length < 2) return null;

    const info = lefffMlex[clean];
    if (info) {
      // In LEFFF dictionary → definitely French, return lemma
      return info[0].lemma;
    }
    // Not in dictionary: keep if it has French diacritics (French word not in dict)
    if (FRENCH_DIACRITIC_RE.test(clean)) return clean;
    // Pure ASCII and not in dict → likely English/noise, discard
    return null;
  }

  console.log("Fetching episodes...");
  const episodes = await get(
    `${SUPABASE_URL}/rest/v1/episodes?select=id,number,duration_sec&order=number.asc&limit=500`
  );
  console.log(`  ${episodes.length} episodes`);

  // Get total segment count
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/segments?select=*`, {
    method: "HEAD",
    headers: { ...HEADERS, Prefer: "count=exact" },
  });
  const contentRange = countRes.headers.get("content-range");
  const total = parseInt(contentRange.split("/")[1]);
  const numPages = Math.ceil(total / PAGE);
  console.log(`Fetching ${total} segments in ${numPages} pages...`);

  const pageRequests = Array.from({ length: numPages }, (_, i) =>
    get(
      `${SUPABASE_URL}/rest/v1/segments?select=episode_id,fr_text,start_ms,end_ms` +
        `&order=episode_id.asc,idx.asc&offset=${i * PAGE}&limit=${PAGE}`
    )
  );
  const pages = await Promise.all(pageRequests);
  const allSegs = pages.flat();
  console.log(`  Got ${allSegs.length} segments`);

  // Group by episode, deduplicate segments by text (import bug in some episodes)
  const segsByEp = new Map();
  for (const s of allSegs) {
    if (!segsByEp.has(s.episode_id)) segsByEp.set(s.episode_id, []);
    segsByEp.get(s.episode_id).push(s);
  }
  let totalDupes = 0;
  for (const [epId, segs] of segsByEp) {
    const seen = new Set();
    const deduped = segs.filter(s => {
      const key = (s.fr_text || "").trim();
      if (key.length > 20 && seen.has(key)) { totalDupes++; return false; }
      seen.add(key);
      return true;
    });
    segsByEp.set(epId, deduped);
  }
  if (totalDupes > 0) console.log(`  Removed ${totalDupes} duplicate segments`);

  // Build proper noun set from ALL text
  console.log("Detecting proper nouns...");
  const allTexts = allSegs.map((s) => s.fr_text || "");
  const properNouns = detectProperNouns(allTexts);
  console.log(`  ${properNouns.size} proper nouns detected`);

  // Process episodes in number order, building cumulative lemma vocab
  const sorted = [...episodes].sort((a, b) => a.number - b.number);
  const cumulativeLemmas = new Set();
  const stats = {};

  for (const ep of sorted) {
    const segs = segsByEp.get(ep.id) || [];
    const texts = segs.map((s) => s.fr_text || "");
    const text = texts.join(" ");
    if (!text.trim()) continue;

    // All surface tokens for totalWords/wordsPerMin (no filtering)
    const allTokens = tokenize(text);

    // Lemmatize: skip proper nouns and non-French words
    const lemmas = [];
    for (const t of allTokens) {
      if (properNouns.has(t)) continue;
      const lemma = getLemma(t);
      if (lemma && !properNouns.has(lemma)) lemmas.push(lemma);
    }

    const uniqueSet = new Set(lemmas);
    const newCount = [...uniqueSet].filter((l) => !cumulativeLemmas.has(l)).length;
    uniqueSet.forEach((l) => cumulativeLemmas.add(l));

    // Speed chart (unchanged)
    const rawSpeeds = segs
      .filter((s) => s.start_ms != null && s.end_ms != null && s.end_ms > s.start_ms)
      .map(
        (s) =>
          (s.fr_text || "").replace(/\s+/g, "").length /
          ((s.end_ms - s.start_ms) / 60000)
      );
    const bSize = Math.max(1, Math.ceil(rawSpeeds.length / BUCKETS));
    const segmentSpeeds = [];
    for (let i = 0; i < rawSpeeds.length; i += bSize) {
      const chunk = rawSpeeds.slice(i, i + bSize);
      segmentSpeeds.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
    }

    stats[ep.id] = {
      totalWords: allTokens.length,
      uniqueForms: uniqueSet.size,   // actually unique lemmas
      newForms: newCount,             // actually new lemmas
      wordsPerMin: ep.duration_sec
        ? Math.round(allTokens.length / (ep.duration_sec / 60))
        : null,
      segmentSpeeds,
    };
  }

  const outPath = path.resolve(__dirname, "..", "public", "ep-stats.json");
  require("fs").writeFileSync(
    outPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      episodeCount: episodes.length,
      stats,
    })
  );
  console.log(`\nWrote ${Object.keys(stats).length} episodes to public/ep-stats.json`);
  console.log(`Cumulative lemma vocab at end: ${cumulativeLemmas.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
