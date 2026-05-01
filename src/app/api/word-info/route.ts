import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
    }

    const body = await req.json();
    const word = String(body?.word ?? "").trim();
    const lemma = String(body?.lemma ?? "").trim();
    const contextFr = String(body?.contextFr ?? "").trim();
    const translationRu = String(body?.translationRu ?? "").trim();

    if (!word) {
      return NextResponse.json({ error: "word is required" }, { status: 400 });
    }

    const prompt = `FR: ${word} (lemma: ${lemma || word}). RU: ${translationRu || "-"}. Context: ${(contextFr || "-").slice(0, 150)}
JSON: grammar (1 line RU), example_fr, example_ru (short).`;

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
          { role: "system", content: "French flashcard. JSON only. Short." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json({ error: "OpenAI request failed", details: details.slice(0, 300) }, { status: 502 });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    return NextResponse.json({
      grammar: String(parsed.grammar ?? "").trim(),
      example_fr: String(parsed.example_fr ?? "").trim(),
      example_ru: String(parsed.example_ru ?? "").trim(),
    });
  } catch (error) {
    return NextResponse.json({ error: "Unexpected server error", details: String(error) }, { status: 500 });
  }
}

