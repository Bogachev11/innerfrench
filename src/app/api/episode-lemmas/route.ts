import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/['']/g, " ")
    .replace(/[-–—]/g, " ");
  const tokens = cleaned.match(/\p{L}+/gu) || [];
  return tokens.filter(Boolean);
}

type SegmentRow = { episode_id: string; fr_text: string; start_ms: number; end_ms: number | null };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const episodeIds = Array.isArray(body?.episodeIds) ? (body.episodeIds as string[]) : [];
    const dayPositions = body?.dayPositions as Array<{ day: string; positions: Record<string, number> }> | undefined;
    if (episodeIds.length === 0) {
      return NextResponse.json({ error: "episodeIds required" }, { status: 400 });
    }

    const segments: SegmentRow[] = [];
    const chunkSize = 50;
    for (let i = 0; i < episodeIds.length; i += chunkSize) {
      const ids = episodeIds.slice(i, i + chunkSize);
      let offset = 0;
      while (true) {
        const { data, error } = await supabaseAdmin
          .from("segments")
          .select("episode_id, fr_text, start_ms, end_ms")
          .in("episode_id", ids)
          .order("episode_id", { ascending: true })
          .order("idx", { ascending: true })
          .range(offset, offset + 999);
        if (error || !data || data.length === 0) break;
        segments.push(...(data as SegmentRow[]));
        if (data.length < 1000) break;
        offset += 1000;
      }
    }

    const nodeLefff = await import("node-lefff");
    const nl = await nodeLefff.default.load();

    if (dayPositions?.length) {
      const lemmasByDay: Record<string, string[]> = {};
      for (const { day, positions } of dayPositions) {
        const set = new Set<string>();
        for (const s of segments) {
          const ep = String(s.episode_id);
          const maxMs = positions[ep];
          if (maxMs == null) continue;
          const segEnd = s.end_ms ?? s.start_ms;
          if (segEnd > maxMs) continue;
          for (const token of tokenize(String(s.fr_text || ""))) {
            set.add((nl.lem(token) || token).toLowerCase());
          }
        }
        lemmasByDay[day] = [...set];
      }
      return NextResponse.json({ lemmasByDay });
    }

    const lemmasByEpisode = new Map<string, Set<string>>();
    for (const s of segments) {
      const ep = String(s.episode_id);
      if (!lemmasByEpisode.has(ep)) lemmasByEpisode.set(ep, new Set());
      for (const token of tokenize(String(s.fr_text || ""))) {
        const lemma = (nl.lem(token) || token).toLowerCase();
        lemmasByEpisode.get(ep)!.add(lemma);
      }
    }
    const out: Record<string, string[]> = {};
    for (const [ep, set] of lemmasByEpisode.entries()) out[ep] = [...set];
    return NextResponse.json({ lemmasByEpisode: out });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
