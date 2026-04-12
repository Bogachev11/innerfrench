"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Episode } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

interface Progress {
  episode_id: string;
  last_position_ms: number;
  total_listened_ms: number;
  completed: boolean;
}

// Per-episode pre-computed stats (cached)
interface EpStats {
  totalWords: number;
  uniqueForms: number;     // unique lemmas (French only)
  newForms: number;        // new lemmas not seen in any episode 1..N-1
  wordsPerMin: number | null;
  segmentSpeeds: number[]; // bucketed ch/min for speed chart
}

// Per-episode sparkline point (filtered to listened)
interface SparkPoint extends EpStats {
  number: number;
  isCurrent: boolean;
}

interface CardStats {
  ep: EpStats;
  sparkline: SparkPoint[];     // listened episodes in order
  segmentSpeeds: number[];     // for this episode's speed chart
}

const C1_EPISODES = new Set([40, 74, 94, 96, 101, 105]);

function formatMin(sec: number) {
  return `${Math.floor(sec / 60)} min`;
}

// Module-level singleton — load the pre-computed JSON once per session
let statsPromise: Promise<Map<string, EpStats>> | null = null;

async function loadStatsMap(): Promise<Map<string, EpStats>> {
  try {
    const res = await fetch("/ep-stats.json");
    if (!res.ok) return new Map();
    const json = await res.json() as { stats: Record<string, EpStats> };
    return new Map(Object.entries(json.stats));
  } catch {
    return new Map();
  }
}

export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [statsMap, setStatsMap] = useState<Map<string, EpStats> | null>(null);

  useEffect(() => {
    const deviceId = getDeviceId();
    supabase
      .from("episode_progress")
      .select("episode_id, last_position_ms, total_listened_ms, completed")
      .eq("device_id", deviceId)
      .then(({ data }) => {
        if (data) setProgress(new Map(data.map((d) => [d.episode_id, d as Progress])));
      });
  }, []);

  // Load pre-computed stats once per session
  useEffect(() => {
    if (!statsPromise) statsPromise = loadStatsMap();
    statsPromise.then(setStatsMap);
  }, []);

  const groupA2 = episodes.filter((ep) => ep.number >= 1 && ep.number <= 34 && !C1_EPISODES.has(ep.number));
  const groupB1 = episodes.filter((ep) => ep.number >= 35 && ep.number <= 79 && !C1_EPISODES.has(ep.number));
  const groupB2 = episodes.filter((ep) => ep.number >= 80 && !C1_EPISODES.has(ep.number));
  const groupC1 = episodes.filter((ep) => C1_EPISODES.has(ep.number));

  return (
    <div className="space-y-4">
      <EpisodeGroup label="A2 (débutant +)"      episodes={groupA2} allEpisodes={episodes} progress={progress} statsMap={statsMap} />
      <EpisodeGroup label="B1 (intermédiaire -)" episodes={groupB1} allEpisodes={episodes} progress={progress} statsMap={statsMap} />
      <EpisodeGroup label="B2 (intermédiaire +)" episodes={groupB2} allEpisodes={episodes} progress={progress} statsMap={statsMap} />
      <EpisodeGroup label="C1 (avancé)"          episodes={groupC1} allEpisodes={episodes} progress={progress} statsMap={statsMap} />
    </div>
  );
}

function EpisodeGroup({
  label, episodes, allEpisodes, progress, statsMap,
}: {
  label: string;
  episodes: Episode[];
  allEpisodes: Episode[];
  progress: Map<string, Progress>;
  statsMap: Map<string, EpStats> | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (episodes.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h2 className="text-xs text-gray-600">{label}</h2>
      {episodes.map((ep) => {
        const p = progress.get(ep.id);
        const done = p?.completed ?? false;
        const durMs = (ep.duration_sec ?? 0) * 1000;
        const pct = durMs > 0 && p ? Math.min((p.last_position_ms / durMs) * 100, 100) : 0;
        const isExpanded = expandedId === ep.id;

        return (
          <div key={ep.id} className="rounded-lg overflow-hidden">
            <div
              className="relative cursor-pointer active:opacity-80 select-none"
              onClick={() => setExpandedId(isExpanded ? null : ep.id)}
            >
              <div className={`absolute inset-0 transition-all ${done ? "bg-progress-done" : "bg-progress-warn"}`}
                style={{ width: done ? "100%" : `${pct}%` }} />
              <div className="absolute inset-0 bg-white/40" style={{ left: done ? "100%" : `${pct}%` }} />
              <div className="relative flex items-center gap-3 px-3 py-2.5">
                <span className={`text-xs font-semibold w-7 text-right tabular-nums ${done ? "text-emerald-600" : "text-gray-400"}`}>
                  {ep.number}
                </span>
                <span className={`flex-1 text-sm leading-snug ${done ? "text-emerald-800" : "text-gray-900"}`}>
                  {ep.title}
                </span>
                {ep.duration_sec != null && ep.duration_sec > 0 && (
                  <span className={`text-xs whitespace-nowrap tabular-nums ${done ? "text-white" : "text-gray-400"}`}>
                    {formatMin(ep.duration_sec)}
                  </span>
                )}
                <span className={`text-xs ${isExpanded ? "text-gray-500" : "text-gray-300"}`}>
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>
            </div>

            <EpisodeStatsCard
              episode={ep}
              allEpisodes={allEpisodes}
              progressMap={progress}
              statsMap={statsMap}
              isOpen={isExpanded}
            />
          </div>
        );
      })}
    </section>
  );
}

function EpisodeStatsCard({
  episode, allEpisodes, progressMap, statsMap, isOpen,
}: {
  episode: Episode;
  allEpisodes: Episode[];
  progressMap: Map<string, Progress>;
  statsMap: Map<string, EpStats> | null;
  isOpen: boolean;
}) {
  const [cardStats, setCardStats] = useState<CardStats | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!innerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (innerRef.current) setHeight(innerRef.current.scrollHeight);
    });
    observer.observe(innerRef.current);
    setHeight(innerRef.current.scrollHeight);
    return () => observer.disconnect();
  }, [cardStats]);

  // Load card stats when opened and statsMap is ready
  useEffect(() => {
    if (!isOpen || !statsMap || cardStats) return;
    buildCardStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, statsMap]);

  function buildCardStats() {
    const ep = statsMap!.get(episode.id) ?? null;
    // Always set cardStats (even null ep) so the Listen button always shows
    if (!ep || ep.totalWords < 200) {
      setCardStats({ ep: ep!, sparkline: [], segmentSpeeds: ep?.segmentSpeeds ?? [] });
      return;
    }

    // Sparkline: listened episodes in number order + current episode
    const listenedIds = new Set([...progressMap.keys()]);
    const sortedAll = [...allEpisodes].sort((a, b) => a.number - b.number);
    const sparkline: SparkPoint[] = sortedAll
      .filter((e) => listenedIds.has(e.id) || e.id === episode.id)
      .map((e) => {
        const s = statsMap!.get(e.id);
        return s ? { ...s, number: e.number, isCurrent: e.id === episode.id } : null;
      })
      .filter(Boolean) as SparkPoint[];

    setCardStats({ ep, sparkline, segmentSpeeds: ep.segmentSpeeds });
  }

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in-out"
      style={{ height: isOpen ? height : 0 }}
    >
      <div ref={innerRef}>
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 space-y-3">
          {!cardStats ? (
            !statsMap && (
              <div className="text-xs text-gray-400 py-2 text-center">Computing stats…</div>
            )
          ) : (
            <>
              {cardStats.ep && cardStats.ep.totalWords >= 200 && (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <MiniChart
                      label="words"
                      value={cardStats.ep.totalWords.toLocaleString("en")}
                      points={cardStats.sparkline.map((s) => s.totalWords)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#6b7280"
                      bars
                    />
                    <MiniChart
                      label="lemmas"
                      value={cardStats.ep.uniqueForms.toLocaleString("en")}
                      points={cardStats.sparkline.map((s) => s.uniqueForms)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#f59e0b"
                      bars
                    />
                    <MiniChart
                      label="new"
                      value={String(cardStats.ep.newForms)}
                      points={cardStats.sparkline.map((s) => s.newForms)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#10b981"
                      bars
                    />
                    <MiniChart
                      label="w/min"
                      value={cardStats.ep.wordsPerMin != null ? String(cardStats.ep.wordsPerMin) : "—"}
                      points={cardStats.sparkline.map((s) => s.wordsPerMin ?? 0)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#8b5cf6"
                    />
                  </div>
                </>
              )}
              <Link
                href={`/episodes/${episode.slug}`}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium active:opacity-80"
              >
                ▶ Listen
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniChart({ label, value, points, currentIdx, color, bars = false }: {
  label: string;
  value: string;
  points: number[];
  currentIdx: number;
  color: string;
  bars?: boolean;
}) {
  const H = 56;
  const PAD = 2;
  const VW = 300;

  const fmt = (v: number) =>
    v >= 10000 ? `${Math.round(v / 1000)}k` :
    v >= 1000  ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max || 1;           // bars always from zero
  const lineRange = max - min || 1; // line uses min–max
  const n = points.length;

  // bar width + gap: fill full VW
  const gap = Math.max(1, VW / n * 0.15);
  const barW = VW / n - gap;

  const coords = points.map((v, i) => ({
    x: (i / (n - 1)) * VW,
    y: PAD + ((max - v) / lineRange) * (H - PAD * 2),
  }));
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const cur = currentIdx >= 0 && currentIdx < coords.length ? coords[currentIdx] : null;

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
        <span className="text-sm font-bold tabular-nums text-gray-800">{value}</span>
      </div>
      <div className="flex items-stretch gap-1.5">
        <div className="flex flex-col justify-between text-[9px] tabular-nums text-gray-400 leading-none shrink-0 w-6 text-right py-px">
          <span>{fmt(max)}</span>
          <span>{bars ? "0" : fmt(min)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${VW} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            className="overflow-visible block"
          >
            {bars ? (
              points.map((v, i) => {
                const bh = Math.max((v / range) * H, 1);
                const x = i * (VW / n) + gap / 2;
                const isCur = i === currentIdx;
                return (
                  <rect
                    key={i}
                    x={x.toFixed(1)}
                    y={(H - bh).toFixed(1)}
                    width={barW.toFixed(1)}
                    height={bh.toFixed(1)}
                    fill={color}
                    fillOpacity={isCur ? 0.9 : 0.35}
                  />
                );
              })
            ) : (
              <>
                <polyline
                  points={pts}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeOpacity="0.65"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {cur && (
                  <circle
                    cx={cur.x} cy={cur.y} r="3"
                    fill={color}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
