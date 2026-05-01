import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const word = String(body?.word ?? "").trim();
    const contextFr = String(body?.contextFr ?? "").trim();
    if (!word) {
      return NextResponse.json({ error: "word is required" }, { status: 400 });
    }

    const prompt = `FR: "${word}" | context: ${contextFr.slice(0, 200)}
JSON: translation, lemma, short_note (optional), translation_2, translation_3 (1-2 other meanings, optional)`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "French→Russian. One phrase. JSON only. Short." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: "OpenAI request failed", details: errText.slice(0, 300) },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { translation: String(content) };
    }

    return NextResponse.json({
      translation: String(parsed.translation ?? "").trim(),
      lemma: String(parsed.lemma ?? word).trim(),
      short_note: String(parsed.short_note ?? "").trim(),
      translation_2: parsed.translation_2 ? String(parsed.translation_2).trim() : undefined,
      translation_3: parsed.translation_3 ? String(parsed.translation_3).trim() : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Unexpected server error", details: String(error) },
      { status: 500 }
    );
  }
}

