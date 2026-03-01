"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId, setDeviceId } from "@/lib/device";

const TZ = "Europe/Paris";
const START_KEY = "2026-03-01";
const TOTAL_EPISODES = 190;

interface EpisodeProgressView {
  number: number;
  ratio: number;
  completed: boolean;
  started: boolean;
}

interface DayEpisode {
  number: number;
  ratio: number;
  completed: boolean;
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
        .select("episode_id, last_position_ms, completed")
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

    const dayMap = new Map<string, Map<number, DayEpisode>>();
    for (const s of sessions) {
      const ep = byEpisodeId.get(s.episode_id);
      if (!ep?.number) continue;
      const key = dayKey(s.started_at);
      const durMs = Math.max(1, (byNumber.get(ep.number)?.duration_sec ?? 0) * 1000);
      const ratio = Math.min(1, (s.end_position_ms || 0) / durMs);
      const completed = ratio >= 0.95;

      if (!dayMap.has(key)) dayMap.set(key, new Map());
      const perEpisode = dayMap.get(key)!;
      const prev = perEpisode.get(ep.number);
      if (!prev || ratio > prev.ratio || (completed && !prev.completed)) {
        perEpisode.set(ep.number, { number: ep.number, ratio, completed });
      }
    }

    const months = buildMonths(dayMap);

    setModel({
      totalMinutes,
      completedCount,
      avgMinutesPerDay,
      months,
      episodeGrid,
    });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <a href="/episodes" className="text-brand text-sm font-medium">← Эпизоды</a>
          <h1 className="text-lg font-bold">Статистика</h1>
          <div className="w-16" />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        {!model ? (
          <p className="text-center text-muted py-12">Загрузка...</p>
        ) : (
          <div className="space-y-7">
            <div className="grid grid-cols-3 gap-2">
              <Card label="Всего минут" value={String(model.totalMinutes)} />
              <Card label="Послушано" value={`${model.completedCount}/${TOTAL_EPISODES}`} />
              <Card label="Среднее / день" value={String(model.avgMinutesPerDay)} />
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Дни и подкасты</h2>
              <div className="overflow-x-auto pb-1">
                <div className="inline-flex gap-4 min-w-max">
                  {model.months.map((month) => (
                    <div key={month.key} className="space-y-2">
                      <div className="text-xs text-gray-500 font-medium">{month.label}</div>
                      <div className="flex items-end gap-1">
                        {month.days.map((day, i) => (
                          <div key={day.key} className="w-3">
                            <div className="h-12 flex flex-col-reverse items-center gap-0.5">
                              {day.episodes.slice(0, 4).map((ep) => (
                                <MiniSquare
                                  key={`${day.key}_${ep.number}`}
                                  ratio={ep.ratio}
                                  completed={ep.completed}
                                  started={true}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <MonthAxis dayKeys={month.days.map((d) => d.key)} />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-2 border-t border-gray-100 pt-4">
              <h2 className="text-sm font-semibold text-gray-700">Все эпизоды (1-190)</h2>
              <div className="grid grid-cols-19 gap-1">
                {model.episodeGrid.map((ep) => (
                  <MiniSquare
                    key={ep.number}
                    ratio={ep.ratio}
                    completed={ep.completed}
                    started={ep.started}
                    title={`#${ep.number}`}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function dayKey(input: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(input));
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
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

function buildMonths(dayMap: Map<string, Map<number, DayEpisode>>): MonthView[] {
  const out: MonthView[] = [];

  let cursor = START_KEY.slice(0, 7);
  const endMonth = dayKey(new Date()).slice(0, 7);
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

function MonthAxis({ dayKeys }: { dayKeys: string[] }) {
  if (dayKeys.length === 0) return null;
  const dayNums = dayKeys.map((k) => Number(k.slice(8, 10)));
  const first = dayNums[0];
  const last = dayNums[dayNums.length - 1];

  return (
    <div className="relative h-7">
      <div className="absolute left-0 right-0 top-2 border-t border-black" />
      {dayNums.map((day, idx) => {
        const isLabel = day === first || day === last || day % 10 === 0;
        if (!isLabel) return null;
        const pct = dayNums.length === 1 ? 0 : (idx / (dayNums.length - 1)) * 100;
        const isFirst = day === first;
        const isLast = day === last;
        const style = isFirst
          ? { left: "0%" }
          : isLast
            ? { left: "100%", transform: "translateX(-100%)" }
            : { left: `${pct}%`, transform: "translateX(-50%)" };
        return (
          <div
            key={`${dayKeys[idx]}_tick`}
            className="absolute top-0"
            style={style}
          >
            <div className="w-px h-2 bg-black mx-auto" />
            <div className="text-[9px] leading-none text-gray-700 mt-0.5">{day}</div>
          </div>
        );
      })}
    </div>
  );
}

function MiniSquare({
  ratio,
  completed,
  started,
  title,
}: {
  ratio: number;
  completed: boolean;
  started: boolean;
  title?: string;
}) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  if (completed) {
    return (
      <div
        title={title}
        className="w-3 h-3 rounded-[3px] bg-emerald-500 text-white text-[8px] leading-3 text-center"
      >
        ✓
      </div>
    );
  }
  if (!started) {
    return <div title={title} className="w-3 h-3 rounded-[3px] bg-gray-200" />;
  }
  return (
    <div title={title} className="w-3 h-3 rounded-[3px] bg-gray-200 relative overflow-hidden">
      <div
        className="absolute left-0 bottom-0 bg-amber-400"
        style={{ width: `${safeRatio * 100}%`, height: "100%" }}
      />
    </div>
  );
}
