"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId, setDeviceId } from "@/lib/device";

const TZ = "Europe/Paris";
const START_KEY = "2026-03-01";
const TOTAL_EPISODES = 190;
const C1_EPISODES = new Set([40, 74, 94, 96, 101, 105]);

interface EpisodeProgressView {
  number: number;
  ratio: number;
  completed: boolean;
  started: boolean;
}

interface DayEpisode {
  number: number;
  fromRatio: number;
  toRatio: number;
  completedToday: boolean;
}

interface DayView {
  key: string;
  episodes: DayEpisode[];
}

interface MonthView {
  key: string; // YYYY-MM
  label: string;
  days: DayView[];
}

interface DashboardModel {
  totalMinutes: number;
  completedCount: number;
  avgMinutesPerDay: number;
  streakDays: number;
  streakBroken: boolean;
  months: MonthView[];
  episodeGrid: EpisodeProgressView[];
}

export default function DashboardPage() {
  const [model, setModel] = useState<DashboardModel | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard(deviceIdOverride?: string) {
    const deviceId = deviceIdOverride ?? getDeviceId();

    const [progressRes, sessionsRes, episodesRes] = await Promise.all([
      supabase
        .from("episode_progress")
        .select("episode_id, last_position_ms, completed, updated_at")
        .eq("device_id", deviceId),
      supabase
        .from("listening_sessions")
        .select("episode_id, started_at, listened_ms, end_position_ms")
        .eq("device_id", deviceId),
      supabase.from("episodes").select("id, number, duration_sec").order("number"),
    ]);

    let progress = progressRes.data || [];
    let sessions = sessionsRes.data || [];
    const episodes = episodesRes.data || [];

    // If this browser got a new random device_id, but DB only has one device_id
    // (single-user setup), adopt it so desktop/mobile show same stats.
    if (!deviceIdOverride && progress.length === 0 && sessions.length === 0) {
      const [allProgressIdsRes, allSessionIdsRes] = await Promise.all([
        supabase.from("episode_progress").select("device_id"),
        supabase.from("listening_sessions").select("device_id, listened_ms"),
      ]);

      const sessionTotals = new Map<string, number>();
      for (const row of allSessionIdsRes.data || []) {
        const key = String(row.device_id);
        const prev = sessionTotals.get(key) ?? 0;
        sessionTotals.set(key, prev + (row.listened_ms || 0));
      }

      let adopted = "";
      if (sessionTotals.size > 0) {
        adopted = [...sessionTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        const ids = new Set<string>();
        for (const row of allProgressIdsRes.data || []) ids.add(String(row.device_id));
        if (ids.size > 0) adopted = [...ids][0];
      }

      if (adopted) {
        setDeviceId(adopted);
        return loadDashboard(adopted);
      }
    }
    const byEpisodeId = new Map(episodes.map((e) => [e.id, e]));
    const byNumber = new Map<number, { duration_sec: number | null }>(
      episodes.map((e) => [e.number, { duration_sec: e.duration_sec }])
    );

    const totalListenedMs = sessions.reduce((sum, s) => sum + (s.listened_ms || 0), 0);
    const totalMinutes = Math.round(totalListenedMs / 60000);
    const completedCount = progress.filter((p) => p.completed).length;
    const avgMinutesPerDay = Math.round(totalMinutes / daysSinceStart());
    const streakInfo = computeStreakDays(sessions);

    const startedNumbers = new Set<number>();
    const lastSessionPosByNumber = new Map<number, number>();
    for (const s of sessions) {
      const ep = byEpisodeId.get(s.episode_id);
      if (!ep?.number) continue;
      startedNumbers.add(ep.number);
      const prev = lastSessionPosByNumber.get(ep.number) ?? 0;
      lastSessionPosByNumber.set(ep.number, Math.max(prev, s.end_position_ms || 0));
    }

    const episodeGrid: EpisodeProgressView[] = Array.from({ length: TOTAL_EPISODES }, (_, i) => ({
      number: i + 1,
      ratio: 0,
      completed: false,
      started: false,
    }));
    for (const p of progress) {
      const ep = byEpisodeId.get(p.episode_id);
      if (!ep) continue;
      const idx = ep.number - 1;
      if (idx < 0 || idx >= TOTAL_EPISODES) continue;
      startedNumbers.add(ep.number);
      const durMs = (ep.duration_sec ?? 0) * 1000;
      const ratio = p.completed ? 1 : durMs > 0 ? Math.min(1, (p.last_position_ms || 0) / durMs) : 0;
      episodeGrid[idx] = { number: ep.number, ratio, completed: !!p.completed, started: true };
    }
    for (const epNumber of startedNumbers) {
      const idx = epNumber - 1;
      if (idx < 0 || idx >= TOTAL_EPISODES) continue;
      if (episodeGrid[idx].started) continue;
      const durMs = (byNumber.get(epNumber)?.duration_sec ?? 0) * 1000;
      const sessionPos = lastSessionPosByNumber.get(epNumber) ?? 0;
      const ratio = durMs > 0 ? Math.min(1, sessionPos / durMs) : 0;
      episodeGrid[idx] = {
        number: epNumber,
        ratio,
        completed: ratio >= 0.95,
        started: true,
      };
    }

    // Timeline shows first-time listening per day (re-listens excluded).
    // Each day's square paints:
    //   [0, fromRatio]      — already-heard portion (from earlier days), warn gradient
    //   [fromRatio, 1]      — green, if the episode was completed on this day
    //   [fromRatio, toRatio]— warn gradient, if just advanced (not yet completed)
    type DaySegment = { fromRatio: number; toRatio: number; completedToday: boolean };
    const epDayMap = new Map<number, Map<string, DaySegment>>();
    const epFrontier = new Map<number, number>();

    const sessionsSorted = [...sessions].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );
    for (const s of sessionsSorted) {
      const ep = byEpisodeId.get(s.episode_id);
      if (!ep?.number) continue;
      const durMs = (byNumber.get(ep.number)?.duration_sec ?? 0) * 1000;
      if (durMs <= 0) continue;
      const endRatio = Math.min(1, (s.end_position_ms || 0) / durMs);
      const prev = epFrontier.get(ep.number) ?? 0;
      if (endRatio <= prev) continue;

      const day = dayKey(s.started_at);
      let segs = epDayMap.get(ep.number);
      if (!segs) {
        segs = new Map();
        epDayMap.set(ep.number, segs);
      }
      const completedNow = endRatio >= 0.95;
      const existing = segs.get(day);
      if (existing) {
        existing.toRatio = Math.max(existing.toRatio, endRatio);
        if (completedNow) existing.completedToday = true;
      } else {
        segs.set(day, { fromRatio: prev, toRatio: endRatio, completedToday: completedNow });
      }
      epFrontier.set(ep.number, endRatio);
    }

    // If progress.completed=true but no session reached the completion threshold,
    // mark completion on progress.updated_at day.
    for (const p of progress) {
      if (!p.completed) continue;
      const ep = byEpisodeId.get(p.episode_id);
      if (!ep?.number) continue;

      let segs = epDayMap.get(ep.number);
      let alreadyCompleted = false;
      if (segs) {
        for (const seg of segs.values()) {
          if (seg.completedToday) { alreadyCompleted = true; break; }
        }
      }
      if (alreadyCompleted) continue;

      const day = dayKey(p.updated_at || new Date());
      const frontier = epFrontier.get(ep.number) ?? 0;
      if (!segs) {
        segs = new Map();
        epDayMap.set(ep.number, segs);
      }
      const existing = segs.get(day);
      if (existing) {
        existing.completedToday = true;
        existing.toRatio = 1;
      } else {
        segs.set(day, { fromRatio: frontier, toRatio: 1, completedToday: true });
      }
      epFrontier.set(ep.number, 1);
    }

    const dayMap = new Map<string, Map<number, DayEpisode>>();
    for (const [epNumber, segs] of epDayMap.entries()) {
      for (const [day, seg] of segs.entries()) {
        if (!dayMap.has(day)) dayMap.set(day, new Map());
        dayMap.get(day)!.set(epNumber, {
          number: epNumber,
          fromRatio: seg.fromRatio,
          toRatio: seg.toRatio,
          completedToday: seg.completedToday,
        });
      }
    }

    const months = buildMonths(dayMap);

    setModel({
      totalMinutes,
      completedCount,
      avgMinutesPerDay,
      streakDays: streakInfo.days,
      streakBroken: streakInfo.broken,
      months,
      episodeGrid,
    });
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-6">
        {!model ? (
          <p className="text-center text-muted py-12">Loading...</p>
        ) : (
          <div className="space-y-7">
            <div className="grid grid-cols-4 gap-2">
              <Card label="Total Minutes" value={String(model.totalMinutes)} />
              <CompletedCard completed={model.completedCount} total={TOTAL_EPISODES} />
              <Card label="Average / Day" value={String(model.avgMinutesPerDay)} />
              <Card label="Streak" value={model.streakBroken ? "🤷‍♂️" : `⚡ ${model.streakDays}`} />
            </div>

            <section>
              {/* section title removed */}
              <div className="space-y-0">
                {model.months.map((month) => {
                  const hasEpisodes = month.days.some((d) => d.episodes.length > 0);
                  return (
                  <div key={month.key} className="space-y-0">
                    <div className="text-xs text-gray-500 font-medium">{month.label}</div>
                    <div
                      className="grid gap-0 items-end"
                      style={{ gridTemplateColumns: `repeat(31, minmax(0, 1fr))`, minHeight: hasEpisodes ? undefined : 40 }}
                    >
                      {month.days.map((day) => (
                        <div key={day.key} className="min-w-0">
                          <div className="flex flex-col justify-end">
                            {Array.from({ length: 4 }).map((_, i) => {
                              const shown = [...day.episodes]
                                .sort((a, b) => {
                                  if (a.completedToday !== b.completedToday) {
                                    return Number(a.completedToday) - Number(b.completedToday);
                                  }
                                  return a.number - b.number;
                                })
                                .slice(0, 4);
                              const startRow = 4 - shown.length;
                              const ep = i < startRow ? undefined : shown[i - startRow];
                              if (!ep) return <div key={`${day.key}_empty_${i}`} />;
                              return (
                                <DaySquare
                                  key={`${day.key}_${ep.number}`}
                                  fromRatio={ep.fromRatio}
                                  toRatio={ep.toRatio}
                                  completedToday={ep.completedToday}
                                  number={ep.number}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-[2px]">
                      <MonthAxis dayKeys={month.days.map((d) => d.key)} todayKey={dayKey(new Date())} />
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2 border-t border-gray-100 pt-4">
              <h2 className="text-sm font-semibold text-gray-700">All Episodes (1-190)</h2>
              <div className="space-y-3">
                <EpisodeGroup
                  label="A2 (débutant +)"
                  episodes={model.episodeGrid.filter(
                    (ep) => ep.number >= 1 && ep.number <= 34 && !C1_EPISODES.has(ep.number)
                  )}
                />
                <EpisodeGroup
                  label="B1 (intermédiaire -)"
                  episodes={model.episodeGrid.filter(
                    (ep) => ep.number >= 35 && ep.number <= 79 && !C1_EPISODES.has(ep.number)
                  )}
                />
                <EpisodeGroup
                  label="B2 (intermédiaire +)"
                  episodes={model.episodeGrid.filter(
                    (ep) => ep.number >= 80 && !C1_EPISODES.has(ep.number)
                  )}
                />
                <EpisodeGroup
                  label="C1 (avancé)"
                  episodes={model.episodeGrid.filter((ep) => C1_EPISODES.has(ep.number))}
                  fixedSize
                />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

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
  let year = get("year");
  let month = get("month");
  let day = get("day");
  const hour = get("hour");

  // Extend "day" until 02:00 Paris time:
  // events between 00:00 and 01:59 belong to previous calendar day.
  if (hour < 2) {
    const prevUtc = new Date(Date.UTC(year, month - 1, day) - 86400000);
    year = prevUtc.getUTCFullYear();
    month = prevUtc.getUTCMonth() + 1;
    day = prevUtc.getUTCDate();
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d);
}

function keyToUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysSinceStart(): number {
  const today = dayKey(new Date());
  const diff = keyToUtcMs(today) - keyToUtcMs(START_KEY);
  return Math.max(1, Math.floor(diff / 86400000) + 1);
}

function computeStreakDays(
  sessions: Array<{ started_at: string; listened_ms: number | null }>
): { days: number; broken: boolean } {
  const activityByDay = new Map<string, { count: number; ms: number }>();
  for (const s of sessions) {
    const key = dayKey(s.started_at);
    const prev = activityByDay.get(key) ?? { count: 0, ms: 0 };
    activityByDay.set(key, {
      count: prev.count + 1,
      ms: prev.ms + (s.listened_ms || 0),
    });
  }

  const activeDays = [...activityByDay.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([key]) => key)
    .sort();
  if (activeDays.length === 0) return { days: 0, broken: true };

  const todayKey = dayKey(new Date());
  const yesterdayMs = keyToUtcMs(todayKey) - 86400000;
  const yesterdayDate = new Date(yesterdayMs);
  const yesterdayKey = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getUTCDate()).padStart(2, "0")}`;

  const latest = activeDays[activeDays.length - 1];
  // Streak is "alive" only if the latest activity is today or yesterday.
  if (latest !== todayKey && latest !== yesterdayKey) {
    return { days: 0, broken: true };
  }

  let streak = 1;
  let cursor = latest;
  const activeSet = new Set(activeDays);

  while (true) {
    const prevMs = keyToUtcMs(cursor) - 86400000;
    const prevDate = new Date(prevMs);
    const prevKey = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}-${String(prevDate.getUTCDate()).padStart(2, "0")}`;
    if (!activeSet.has(prevKey)) break;
    streak += 1;
    cursor = prevKey;
  }

  return { days: streak, broken: false };
}

function buildMonths(dayMap: Map<string, Map<number, DayEpisode>>): MonthView[] {
  const out: MonthView[] = [];

  let cursor = START_KEY.slice(0, 7);
  // Show next month only after mid-month; otherwise stop at current month
  const now = new Date();
  const showNextMonth = now.getUTCDate() >= 15;
  const nextM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (showNextMonth ? 1 : 0), 1));
  const endMonth = `${nextM.getUTCFullYear()}-${String(nextM.getUTCMonth() + 1).padStart(2, "0")}`;
  while (cursor <= endMonth) {
    const [yy, mm] = cursor.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const days: DayView[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (key < START_KEY) continue;
      const eps = [...(dayMap.get(key)?.values() ?? [])].sort((a, b) => a.number - b.number);
      days.push({ key, episodes: eps });
    }
    out.push({ key: cursor, label: monthLabel(cursor), days });
    const nextMonthDate = new Date(Date.UTC(yy, mm, 1));
    const ny = nextMonthDate.getUTCFullYear();
    const nm = nextMonthDate.getUTCMonth() + 1;
    cursor = `${ny}-${String(nm).padStart(2, "0")}`;
  }
  return out;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-2.5 py-3">
      <div className="text-lg font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

function CompletedCard({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
  return (
    <div className="bg-gray-50 rounded-xl px-2.5 py-3">
      <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
        <div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">
            {completed}/{total}
          </div>
          <div className="text-[11px] text-muted mt-0.5 leading-tight">Completed</div>
        </div>
        <div className="relative w-2 self-stretch rounded-full bg-gray-200 overflow-hidden">
          <div
            className="absolute left-0 right-0 bottom-0 bg-progress-done"
            style={{ height: `${pct * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MonthAxis({
  dayKeys,
  todayKey,
  totalSlots = 31,
}: {
  dayKeys: string[];
  todayKey?: string;
  totalSlots?: number;
}) {
  if (dayKeys.length === 0) return null;
  const dayNums = dayKeys.map((k) => Number(k.slice(8, 10)));
  const first = dayNums[0];
  const lastDay = dayNums[dayNums.length - 1];
  const todayIdx = todayKey ? dayKeys.indexOf(todayKey) : -1;
  const NEAR = 3;

  return (
    <div className="relative h-5">
      <div className="absolute top-0 border-t border-black" style={{ left: 0, width: `${(dayNums.length / totalSlots) * 100}%` }} />
      {dayNums.map((day, idx) => {
        const isToday = idx === todayIdx;
        const isAnchor = day === first || day === 10 || day === 20 || day === lastDay;
        const nearToday = todayIdx >= 0 && idx !== todayIdx && Math.abs(idx - todayIdx) <= NEAR;
        const isLabel = isToday || (isAnchor && !nearToday);
        if (!isLabel) return null;
        const pct = ((idx + 0.5) / totalSlots) * 100;
        return (
          <div
            key={`${dayKeys[idx]}_tick`}
            className="absolute top-0"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          >
            <div className="w-px h-1 bg-black mx-auto" />
            <div className={`text-[11px] leading-none mt-0 ${isToday ? "font-bold text-black" : "text-gray-700"}`}>{day}</div>
          </div>
        );
      })}
    </div>
  );
}

function DaySquare({
  fromRatio,
  toRatio,
  completedToday,
  number,
}: {
  fromRatio: number;
  toRatio: number;
  completedToday: boolean;
  number: number;
}) {
  const from = Math.max(0, Math.min(1, fromRatio));
  const to = Math.max(from, Math.min(1, toRatio));
  const fullyPainted = completedToday && from === 0;
  const textColor = fullyPainted ? "text-white" : "text-gray-700";
  const borderClass = fullyPainted ? "" : "ring-1 ring-inset ring-gray-300";

  return (
    <div className={`w-full aspect-square rounded-[2px] relative overflow-hidden ${borderClass}`}>
      {completedToday ? (
        <div
          className="absolute top-0 bottom-0 bg-progress-done"
          style={{ left: `${from * 100}%`, right: 0 }}
        />
      ) : (
        to > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 bg-progress-warn"
            style={{ width: `${to * 100}%` }}
          />
        )
      )}
      <div className={`absolute inset-0 ${textColor} text-[6px] leading-none flex items-center justify-center font-medium`}>
        {number}
      </div>
    </div>
  );
}

function MiniSquare({
  ratio,
  completed,
  started,
  number,
  size = "xs",
  title,
}: {
  ratio: number;
  completed: boolean;
  started: boolean;
  number?: number;
  size?: "xs" | "md";
  title?: string;
}) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const isMd = size === "md";
  const baseSize = isMd ? "w-full aspect-square rounded-[4px]" : "w-full aspect-square rounded-[2px]";
  const textSize = isMd ? "text-[8px] sm:text-[9px]" : "text-[6px]";

  if (completed) {
    return (
      <div
        title={title}
        className={`${baseSize} bg-progress-done text-white ${textSize} leading-none flex items-center justify-center font-semibold`}
      >
        {number ?? "✓"}
      </div>
    );
  }
  if (!started) {
    return (
      <div
        title={title}
        className={`${baseSize} bg-gray-200 text-gray-500 ${textSize} leading-none flex items-center justify-center font-medium`}
      >
        {number ?? ""}
      </div>
    );
  }
  return (
    <div title={title} className={`${baseSize} bg-gray-200 relative overflow-hidden`}>
      <div
        className="absolute left-0 bottom-0 bg-progress-warn"
        style={{ width: `${safeRatio * 100}%`, height: "100%" }}
      />
      {typeof number === "number" && (
        <div className={`absolute inset-0 text-gray-700 ${textSize} leading-none flex items-center justify-center font-medium`}>
          {number}
        </div>
      )}
    </div>
  );
}

function EpisodeGroup({
  label,
  episodes,
  fixedSize = false,
}: {
  label: string;
  episodes: EpisodeProgressView[];
  fixedSize?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div
        className="grid gap-0"
        style={{
          gridTemplateColumns: fixedSize
            ? "repeat(auto-fill, minmax(24px, 24px))"
            : "repeat(auto-fit, minmax(24px, 1fr))",
        }}
      >
        {episodes.map((ep) => (
          <MiniSquare
            key={`${label}_${ep.number}`}
            ratio={ep.ratio}
            completed={ep.completed}
            started={ep.started}
            number={ep.number}
            size="md"
            title={`#${ep.number}`}
          />
        ))}
      </div>
    </div>
  );
}
