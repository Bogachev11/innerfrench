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
  uniqueForms: number;
  newForms: number;        // forms not seen in any episode 1..N-1
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
                  <div className="grid grid-cols-4 gap-2">
                    <KpiWithSpark
                      label="words"
                      value={cardStats.ep.totalWords.toLocaleString("en")}
                      points={cardStats.sparkline.map((s) => s.totalWords)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#6b7280"
                    />
                    <KpiWithSpark
                      label="forms"
                      value={cardStats.ep.uniqueForms.toLocaleString("en")}
                      points={cardStats.sparkline.map((s) => s.uniqueForms)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#f59e0b"
                    />
                    <KpiWithSpark
                      label="new"
                      value={String(cardStats.ep.newForms)}
                      points={cardStats.sparkline.map((s) => s.newForms)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#10b981"
                    />
                    <KpiWithSpark
                      label="w/min"
                      value={cardStats.ep.wordsPerMin != null ? String(cardStats.ep.wordsPerMin) : "—"}
                      points={cardStats.sparkline.map((s) => s.wordsPerMin ?? 0)}
                      currentIdx={cardStats.sparkline.findIndex((s) => s.isCurrent)}
                      color="#8b5cf6"
                    />
                  </div>
                  {cardStats.segmentSpeeds.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-gray-500">Speed across episode (ch/min)</div>
                      <SegmentSpeedChart speeds={cardStats.segmentSpeeds} />
                    </div>
                  )}
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

function KpiWithSpark({ label, value, points, currentIdx, color }: {
  label: string;
  value: string;
  points: number[];
  currentIdx: number;
  color: string;
}) {
  return (
    <div className="text-center">
      <div className="text-base font-bold tabular-nums text-gray-800">{value}</div>
      <div className="text-[10px] text-gray-400 leading-tight mb-1">{label}</div>
      <Sparkline values={points} currentIdx={currentIdx} color={color} />
    </div>
  );
}

function Sparkline({ values, currentIdx, color }: {
  values: number[];
  currentIdx: number;
  color: string;
}) {
  if (values.length < 2) return <div className="h-4" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 52, H = 18;
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 3) - 1.5,
  }));
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const cur = currentIdx >= 0 ? coords[currentIdx] : null;

  return (
    <svg width={W} height={H} className="overflow-visible mx-auto block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2"
        strokeOpacity="0.5" strokeLinejoin="round" strokeLinecap="round" />
      {cur && (
        <circle cx={cur.x} cy={cur.y} r="2.5" fill={color} stroke="white" strokeWidth="1" />
      )}
    </svg>
  );
}

function SegmentSpeedChart({ speeds }: { speeds: number[] }) {
  const max = Math.max(...speeds);
  const min = Math.min(...speeds, 0);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-px h-8">
      {speeds.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(((v - min) / range) * 100, 4)}%`,
            backgroundColor: `hsl(${210 + ((v - min) / range) * 60}, 70%, 55%)`,
          }}
        />
      ))}
    </div>
  );
}
