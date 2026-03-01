"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

interface Stats {
  totalMinutes: number;
  last7dMinutes: number;
  last30dMinutes: number;
  streak: number;
  started: number;
  completed: number;
  total: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const deviceId = getDeviceId();

    const [progressRes, sessionsRes, totalRes] = await Promise.all([
      supabase
        .from("episode_progress")
        .select("episode_id, total_listened_ms, completed")
        .eq("device_id", deviceId),
      supabase
        .from("listening_sessions")
        .select("started_at, listened_ms")
        .eq("device_id", deviceId),
      supabase.from("episodes").select("id", { count: "exact", head: true }),
    ]);

    const progress = progressRes.data || [];
    const sessions = sessionsRes.data || [];
    const total = totalRes.count || 0;

    const totalMs = progress.reduce((s, p) => s + (p.total_listened_ms || 0), 0);
    const completed = progress.filter((p) => p.completed).length;
    const started = progress.length;

    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86400000);
    const d30 = new Date(now.getTime() - 30 * 86400000);

    let ms7 = 0, ms30 = 0;
    for (const s of sessions) {
      const d = new Date(s.started_at);
      const ms = s.listened_ms || 0;
      if (d >= d30) ms30 += ms;
      if (d >= d7) ms7 += ms;
    }

    // Streak: consecutive days with sessions
    const daySet = new Set<string>();
    for (const s of sessions) {
      const d = new Date(s.started_at);
      daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (daySet.has(key)) streak++;
      else if (i > 0) break;
    }

    setStats({
      totalMinutes: Math.round(totalMs / 60000),
      last7dMinutes: Math.round(ms7 / 60000),
      last30dMinutes: Math.round(ms30 / 60000),
      streak,
      started,
      completed,
      total,
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
        {!stats ? (
          <p className="text-center text-muted py-12">Загрузка...</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <Card label="Серия (дни)" value={stats.streak} />
              <Card label="Всего мин." value={stats.totalMinutes} />
              <Card label="Мин. за 7 дн." value={stats.last7dMinutes} />
              <Card label="Мин. за 30 дн." value={stats.last30dMinutes} />
            </div>
            <div className="border-t border-gray-100 pt-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Прогресс эпизодов</h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted">Начато: <b className="text-gray-900">{stats.started}</b></span>
                <span className="text-muted">Завершено: <b className="text-gray-900">{stats.completed}</b></span>
                <span className="text-muted">Всего: <b className="text-gray-900">{stats.total}</b></span>
              </div>
              <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all"
                  style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}
