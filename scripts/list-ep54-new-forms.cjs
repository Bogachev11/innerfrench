#!/usr/bin/env node
/**
 * List all new lemmas introduced in episode 54.
 * "New" means the lemma does not appear in the cumulative vocab built from episodes 1..53.
 * Proper nouns and non-French words (not in LEFFF) are excluded.
 */

const path = require("path");
const { config } = require("dotenv");
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HEADERS = { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY };
const PAGE = 1000;
const FRENCH_DIACRITIC_RE = /[àâçéèêëîïôùûüÿœæ]/;

async function get(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function tokenize(text) {
  return (text || "").toLowerCase().match(/[a-zàâçéèêëîïôùûüÿœæ'-]+/g) || [];
}

function detectProperNouns(texts) {
  const properNouns = new Set();
  const re = /(?<![.!?…]\s)(?<!\n)\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜŒÆ][a-zàâçéèêëîïôùûüÿœæ'-]{1,})\b/g;
  for (const text of texts) {
    let m;
    while ((m = re.exec(text)) !== null) properNouns.add(m[1].toLowerCase());
  }
  return properNouns;
}

async function main() {
  console.error("Loading LEFFF dictionary...");
  const nodeLefff = require("node-lefff");
  const lefff = await nodeLefff.load();
  const lefffMlex = lefff.getLefffMlex();
  console.error(`  ${Object.keys(lefffMlex).length} entries`);

  function getLemma(token) {
    if (token.length < 2) return null;
    const clean = token.replace(/^[-']+|[-']+$/g, "");
    if (clean.length < 2) return null;
    const info = lefffMlex[clean];
    if (info) return info[0].lemma;
    if (FRENCH_DIACRITIC_RE.test(clean)) return clean;
    return null; // non-French / English
  }

  console.error("Fetching episodes...");
  const episodes = await get(
    `${SUPABASE_URL}/rest/v1/episodes?select=id,number&order=number.asc&limit=500`
  );

  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/segments?select=*`, {
    method: "HEAD",
    headers: { ...HEADERS, Prefer: "count=exact" },
  });
  const total = parseInt(countRes.headers.get("content-range").split("/")[1]);
  console.error(`Fetching ${total} segments...`);

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE) }, (_, i) =>
      get(
        `${SUPABASE_URL}/rest/v1/segments?select=episode_id,fr_text` +
          `&order=episode_id.asc,idx.asc&offset=${i * PAGE}&limit=${PAGE}`
      )
    )
  );
  const allSegs = pages.flat();

  const segsByEp = new Map();
  for (const s of allSegs) {
    if (!segsByEp.has(s.episode_id)) segsByEp.set(s.episode_id, []);
    segsByEp.get(s.episode_id).push(s);
  }

  const allTexts = allSegs.map((s) => s.fr_text || "");
  const properNouns = detectProperNouns(allTexts);
  console.error(`  ${properNouns.size} proper nouns detected`);

  const ep54 = episodes.find((e) => e.number === 54);
  const sorted = [...episodes].sort((a, b) => a.number - b.number);
  const cumulativeLemmas = new Set();

  for (const ep of sorted) {
    if (ep.number >= 54) continue;
    const text = (segsByEp.get(ep.id) || []).map((s) => s.fr_text || "").join(" ");
    for (const t of tokenize(text)) {
      if (properNouns.has(t)) continue;
      const lemma = getLemma(t);
      if (lemma && !properNouns.has(lemma)) cumulativeLemmas.add(lemma);
    }
  }
  console.error(`Cumulative lemma vocab after ep 1..53: ${cumulativeLemmas.size}`);

  const text54 = (segsByEp.get(ep54.id) || []).map((s) => s.fr_text || "").join(" ");
  const lemmas54 = new Set();
  for (const t of tokenize(text54)) {
    if (properNouns.has(t)) continue;
    const lemma = getLemma(t);
    if (lemma && !properNouns.has(lemma)) lemmas54.add(lemma);
  }

  const newLemmas = [...lemmas54]
    .filter((l) => !cumulativeLemmas.has(l))
    .sort((a, b) => a.localeCompare(b, "fr"));

  console.error(`\nEpisode 54: ${lemmas54.size} unique lemmas, ${newLemmas.length} new lemmas\n`);
  for (const l of newLemmas) console.log(l);
}

main().catch((e) => { console.error(e); process.exit(1); });
