import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function canonicalKey(word: string, lemma: string | null): string {
  return ((lemma || word) || "").trim().toLowerCase();
}

async function fetchWordInfoFromOpenAI(
  apiKey: string,
  word: string,
  lemma: string,
  translationRu: string,
  contextFr: string
): Promise<{ grammar: string; example_fr: string; example_ru: string }> {
  const prompt = [
    "Give short learning info for one French word (for flashcards).",
    "Return strict JSON with keys: grammar, example_fr, example_ru.",
    "grammar: one short line in Russian (part of speech + key grammar detail).",
    "example_fr/example_ru: one natural short usage example and translation.",
    `word: ${word}`,
    `lemma: ${lemma || word}`,
    `known_translation_ru: ${translationRu || "-"}`,
    `context_fr: ${contextFr || "-"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a concise French tutor. Keep output short and practical for learners.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return {
    grammar: String(parsed.grammar ?? "").trim(),
    example_fr: String(parsed.example_fr ?? "").trim(),
    example_ru: String(parsed.example_ru ?? "").trim(),
  };
}

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const { data: wordsRaw } = await supabaseAdmin
      .from("user_words")
      .select("word, lemma, translation_ru, context_fr");
    const words = wordsRaw || [];
    const byKey = new Map<string, { word: string; lemma: string | null; translation_ru: string; context_fr: string }>();
    for (const w of words) {
      const row = w as { word: string; lemma: string | null; translation_ru: string; context_fr: string };
      const key = canonicalKey(row.word, row.lemma);
      if (!byKey.has(key)) byKey.set(key, row);
    }

    const { data: existingRaw } = await supabaseAdmin.from("word_info").select("canonical_key");
    const existing = new Set((existingRaw || []).map((r) => String((r as { canonical_key: string }).canonical_key)));

    const toFetch = [...byKey.entries()].filter(([key]) => !existing.has(key));
    let done = 0;
    for (const [canonical_key, row] of toFetch) {
      try {
        const info = await fetchWordInfoFromOpenAI(
          apiKey,
          row.word,
          row.lemma || row.word,
          row.translation_ru || "",
          row.context_fr || ""
        );
        await supabaseAdmin.from("word_info").upsert(
          { canonical_key, grammar: info.grammar, example_fr: info.example_fr, example_ru: info.example_ru },
          { onConflict: "canonical_key" }
        );
        done += 1;
      } catch (e) {
        console.warn(`word_info prefill failed for ${canonical_key}:`, e);
      }
    }

    return NextResponse.json({ total: byKey.size, existing: existing.size, prefilled: done });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
