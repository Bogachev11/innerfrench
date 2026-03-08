"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId, setDeviceId } from "@/lib/device";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const TZ = "Europe/Paris";
const START_KEY = "2026-03-01";

type Point = { day: string; value: number };
type ChartPoint = { dayIndex: number; value: number };
type ChartPointVocab = { dayIndex: number; added: number; mastered: number };

function dayKey(input: string | Date): string {
  const d = new Date(input);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
  let y = get("year");
  let m = get("month");
  let day = get("day");
  const h = get("hour");
  if (h < 2) {
    const prev = new Date(Date.UTC(y, m - 1, day) - 86400000);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    day = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeWordForms(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[-–—]/g, " ");
  const tokens = cleaned.match(/\p{L}+/gu) || [];
  return tokens.filter(Boolean);
}

function addDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function keyToDateUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addMonthsToKey(key: string, months: number): string {
  const d = keyToDateUtc(key);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function diffDays(a: string, b: string): number {
  return Math.floor((keyToDateUtc(b).getTime() - keyToDateUtc(a).getTime()) / 86400000);
}

function fmtMonthTickLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(keyToDateUtc(dateKey));
}

function buildYTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0, 1000];
  if (maxValue < 1000) {
    const roughStep = maxValue / 5;
    const small = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const step = small.find((v) => v >= roughStep) ?? 500;
    const maxTick = Math.max(step, Math.ceil(maxValue / step) * step);
    const ticks: number[] = [];
    for (let t = 0; t <= maxTick; t += step) ticks.push(t);
    return ticks;
  }
  const roughStep = maxValue / 5;
  const allowed = [1000, 2000, 5000, 10000, 20000, 50000];
  const step = allowed.find((v) => v >= roughStep) ?? 100000;
  const maxTick = Math.max(step, Math.ceil(maxValue / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= maxTick; t += step) ticks.push(t);
  return ticks;
}

function fmtY(value: number): string {
  if (value <= 0) return "0";
  if (value < 1000) return String(value);
  return `${Math.round(value / 1000)}K`;
}

async function fetchSegmentsForEpisodes(episodeIds: string[]): Promise<Array<{ episode_id: string; fr_text: string }>> {
  const out: Array<{ episode_id: string; fr_text: string }> = [];
  const chunkSize = 50;
  for (let i = 0; i < episodeIds.length; i += chunkSize) {
    const ids = episodeIds.slice(i, i + chunkSize);
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("segments")
        .select("episode_id, fr_text")
        .in("episode_id", ids)
        .order("episode_id", { ascending: true })
        .order("idx", { ascending: true })
        .range(offset, offset + 999);
      if (error || !data || data.length === 0) break;
      out.push(...(data as Array<{ episode_id: string; fr_text: string }>));
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}

function canonicalKey(word: string, lemma: string | null): string {
  return ((lemma || word) || "").trim().toLowerCase();
}

export default function WordCountPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [pointsAdded, setPointsAdded] = useState<Point[]>([]);
  const [pointsMastered, setPointsMastered] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function load() {
    const deviceId = getDeviceId();
    const { data: sessionsRaw } = await supabase
      .from("listening_sessions")
      .select("episode_id, started_at")
      .eq("device_id", deviceId);
    let sessions = sessionsRaw || [];
    let effectiveDeviceId = deviceId;

    // Same fallback as dashboard: if current browser has a new device_id,
    // adopt the most active historical one in this single-user setup.
    if (sessions.length === 0) {
      const { data: allSessions } = await supabase
        .from("listening_sessions")
        .select("device_id, listened_ms");
      const totals = new Map<string, number>();
      for (const s of allSessions || []) {
        const key = String(s.device_id);
        totals.set(key, (totals.get(key) || 0) + (s.listened_ms || 0));
      }
      const adopted = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (adopted) {
        setDeviceId(adopted);
        effectiveDeviceId = adopted;
        const retry = await supabase
          .from("listening_sessions")
          .select("episode_id, started_at")
          .eq("device_id", adopted);
        sessions = retry.data || [];
      }
    }

    const firstDayByEpisode = new Map<string, string>();
    for (const s of sessions) {
      const ep = String(s.episode_id);
      const day = dayKey(s.started_at as string);
      const prev = firstDayByEpisode.get(ep);
      if (!prev || day < prev) firstDayByEpisode.set(ep, day);
    }

    const episodeIds = [...firstDayByEpisode.keys()];
    if (episodeIds.length === 0) {
      setPoints([]);
      return;
    }

    const segments = await fetchSegmentsForEpisodes(episodeIds);
    const formsByEpisode = new Map<string, Set<string>>();
    for (const s of segments) {
      const ep = String(s.episode_id);
      if (!formsByEpisode.has(ep)) formsByEpisode.set(ep, new Set());
      const bucket = formsByEpisode.get(ep)!;
      for (const token of normalizeWordForms(String(s.fr_text || ""))) bucket.add(token);
    }

    const newFormsByDay = new Map<string, Set<string>>();
    for (const [ep, day] of firstDayByEpisode.entries()) {
      const forms = formsByEpisode.get(ep);
      if (!forms || forms.size === 0) continue;
      if (!newFormsByDay.has(day)) newFormsByDay.set(day, new Set());
      const dst = newFormsByDay.get(day)!;
      for (const f of forms) dst.add(f);
    }

    const lastSessionDay = [...firstDayByEpisode.values()].sort().slice(-1)[0] || START_KEY;
    const today = dayKey(new Date());
    const minHorizon = addMonthsToKey(START_KEY, 3);
    const lastDay = [lastSessionDay, today, minHorizon].sort().slice(-1)[0];
    const out: Point[] = [];
    const cumulative = new Set<string>();

    for (let cursor = START_KEY; cursor <= lastDay; cursor = addDay(cursor)) {
      out.push({ day: cursor, value: cumulative.size });
      const plus = newFormsByDay.get(cursor);
      if (plus) for (const f of plus) cumulative.add(f);
    }
    setPoints(out);

    // Added words (user_words) and mastered (user_word_progress) for second chart
    const { data: userWordsRaw } = await supabase
      .from("user_words")
      .select("word, lemma, created_at")
      .eq("device_id", effectiveDeviceId);
    const addedByDay = new Map<string, Set<string>>();
    for (const w of userWordsRaw || []) {
      const day = dayKey((w as { created_at: string }).created_at);
      if (!addedByDay.has(day)) addedByDay.set(day, new Set());
      addedByDay.get(day)!.add(canonicalKey(String((w as { word: string }).word), (w as { lemma: string | null }).lemma));
    }
    const { data: masteredRaw } = await supabase
      .from("user_word_progress")
      .select("mastered_at")
      .eq("device_id", effectiveDeviceId)
      .not("mastered_at", "is", null);
    const masteredByDay = new Map<string, number>();
    for (const r of masteredRaw || []) {
      const day = dayKey((r as { mastered_at: string }).mastered_at);
      masteredByDay.set(day, (masteredByDay.get(day) || 0) + 1);
    }
    const addedSet = new Set<string>();
    const addedPoints: Point[] = [];
    let masteredCumul = 0;
    const masteredPoints: Point[] = [];
    for (const p of out) {
      const plus = addedByDay.get(p.day);
      if (plus) for (const k of plus) addedSet.add(k);
      addedPoints.push({ day: p.day, value: addedSet.size });
      masteredCumul += masteredByDay.get(p.day) || 0;
      masteredPoints.push({ day: p.day, value: masteredCumul });
    }
    setPointsAdded(addedPoints);
    setPointsMastered(masteredPoints);
  }

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const maxY = Math.max(1, points[points.length - 1].value);
    const totalDays = points.length;
    const todayKey = dayKey(new Date());
    const todayIndex = Math.max(1, Math.min(totalDays, diffDays(START_KEY, todayKey) + 1));
    const monthTicks: number[] = [];
    const monthLabelByTick = new Map<number, string>();
    let prevMonth = "";
    for (let i = 0; i < points.length; i += 1) {
      const key = points[i].day;
      const month = key.slice(0, 7);
      if (month !== prevMonth) {
        const tick = i + 1;
        monthTicks.push(tick);
        monthLabelByTick.set(tick, fmtMonthTickLabel(key));
        prevMonth = month;
      }
    }
    const chartData: ChartPoint[] = points
      .slice(0, todayIndex)
      .map((p, i) => ({ dayIndex: i + 1, value: p.value }));
    const yTicks = buildYTicks(maxY);
    const yMax = yTicks[yTicks.length - 1] ?? maxY;

    return {
      maxY,
      totalDays,
      todayIndex,
      monthTicks,
      monthLabelByTick,
      chartData,
      yTicks,
      yMax,
    };
  }, [points]);

  const view2 = useMemo(() => {
    if (points.length === 0 || pointsAdded.length !== points.length || pointsMastered.length !== points.length || !view) return null;
    const totalDays = points.length;
    const todayIndex = Math.max(1, Math.min(totalDays, diffDays(START_KEY, dayKey(new Date())) + 1));
    const maxVal = Math.max(
      1,
      ...pointsAdded.slice(0, todayIndex).map((p) => p.value),
      ...pointsMastered.slice(0, todayIndex).map((p) => p.value)
    );
    const chartData2: ChartPointVocab[] = pointsAdded
      .slice(0, todayIndex)
      .map((p, i) => ({ dayIndex: i + 1, added: p.value, mastered: pointsMastered[i]?.value ?? 0 }));
    const yTicks2 = buildYTicks(maxVal);
    const yMax2 = yTicks2[yTicks2.length - 1] ?? maxVal;
    return {
      chartData2,
      yTicks2,
      yMax2,
      totalDays: view.totalDays,
      monthTicks: view.monthTicks,
      monthLabelByTick: view.monthLabelByTick,
    };
  }, [points, pointsAdded, pointsMastered, view]);

  const addedCount = view2?.chartData2?.length
    ? view2.chartData2[view2.chartData2.length - 1]?.added ?? 0
    : 0;
  const masteredCount = view2?.chartData2?.length
    ? view2.chartData2[view2.chartData2.length - 1]?.mastered ?? 0
    : 0;

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">Loading...</div>
        ) : !view ? (
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">No data yet.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <WordCountCard label="Total word forms" value={view.maxY} />
              <WordCountCard label="Added" value={addedCount} />
              <WordCountCard label="Mastered" value={masteredCount} />
            </div>
          <div className="px-2 pb-1 space-y-2">
            <div className="w-full" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={view.chartData} margin={{ top: 6, right: 6, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="totalWordsGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#bbf7d0" />
                      <stop offset="45%" stopColor="#86efac" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    type="number"
                    dataKey="dayIndex"
                    domain={[1, view.totalDays]}
                    ticks={view.monthTicks}
                    tickFormatter={(v) => view.monthLabelByTick.get(Number(v)) || ""}
                    tick={{ fill: "#374151", fontSize: 12 }}
                    axisLine={{ stroke: "#111827" }}
                    tickLine={{ stroke: "#111827" }}
                  />
                  <YAxis
                    width={28}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={fmtY}
                    ticks={view.yTicks}
                    domain={[0, view.yMax]}
                    tick={{ fill: "#374151" }}
                    tickLine={false}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="value"
                    stroke="url(#totalWordsGrad)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {view2 && (
              <>
                <div className="text-sm font-medium text-gray-700 px-2">Added words / Mastered</div>
                <div className="w-full" style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={view2.chartData2} margin={{ top: 6, right: 6, left: 0, bottom: 8 }}>
                      <defs>
                        <linearGradient id="addedWordsGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#ec4899" />
                          <stop offset="55%" stopColor="#f59e0b" />
                          <stop offset="100%" stopColor="#f4e56d" />
                        </linearGradient>
                        <linearGradient id="masteredWordsGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#bbf7d0" />
                          <stop offset="45%" stopColor="#86efac" />
                          <stop offset="100%" stopColor="#34d399" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="dayIndex"
                        domain={[1, view2.totalDays]}
                        ticks={view2.monthTicks}
                        tickFormatter={(v) => view2.monthLabelByTick.get(Number(v)) || ""}
                        tick={{ fill: "#374151", fontSize: 12 }}
                        axisLine={{ stroke: "#111827" }}
                        tickLine={{ stroke: "#111827" }}
                      />
                      <YAxis
                        width={28}
                        axisLine={false}
                        fontSize={12}
                        tickFormatter={fmtY}
                        ticks={view2.yTicks2}
                        domain={[0, view2.yMax2]}
                        tick={{ fill: "#374151" }}
                        tickLine={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="added"
                        name="Added"
                        stroke="url(#addedWordsGrad)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="mastered"
                        name="Mastered"
                        stroke="url(#masteredWordsGrad)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
          </div>
        )}
      </main>
    </div>
  );
}

function WordCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-xl px-2.5 py-3">
      <div className="text-lg font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

