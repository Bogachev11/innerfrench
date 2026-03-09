"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ProgressRow = {
  id: string;
  device_id: string;
  canonical_key: string;
  display_word: string;
  lemma: string | null;
  translation_ru: string | null;
  correct_count: number;
  correct_days: number;
  last_correct_day: string | null;
  next_review_at: string;
  mastered_at: string | null;
  review_stage: number;
};

type UserWordRow = {
  word: string;
  lemma: string | null;
  translation_ru: string;
  context_fr: string;
  context_ru: string | null;
  created_at: string;
};

type WordInfo = {
  grammar: string;
  example_fr: string;
  example_ru: string;
};

const DAY_MS = 86400000;
const KNOWS_TO_ADVANCE = 5;
const TZ = "Europe/Paris";

function getCurrentMonthParis(): { year: number; month: number; daysInMonth: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  const year = get("year");
  const month = get("month");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, daysInMonth };
}

function dayKeyParis(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  let y = get("year");
  let m = get("month");
  let day = get("day");
  const h = get("hour");
  if (h < 2) {
    const prev = new Date(Date.UTC(y, m - 1, day) - DAY_MS);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    day = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function canonicalKey(word: string, lemma: string | null) {
  return (lemma || word).trim().toLowerCase();
}

function addDaysIso(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function VocabPage() {
  const [due, setDue] = useState<ProgressRow[]>([]);
  const [current, setCurrent] = useState<ProgressRow | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [pendingAction, setPendingAction] = useState<"know" | "dontknow" | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, mastered: 0, due: 0 });
  const [samplesByCanonical, setSamplesByCanonical] = useState<
    Record<string, { context_fr: string; context_ru: string | null }>
  >({});
  const [infoByCanonical, setInfoByCanonical] = useState<Record<string, WordInfo>>({});
  const [infoLoading, setInfoLoading] = useState(false);
  const [reviewEvents, setReviewEvents] = useState<Array<{ canonical_key: string; reviewed_at: string; correct: boolean }>>([]);
  const [chartMounted, setChartMounted] = useState(false);
  useEffect(() => {
    setChartMounted(true);
  }, []);

  const progressText = useMemo(
    () => (stats.total === 0 ? "0%" : `${Math.round((stats.mastered / stats.total) * 100)}%`),
    [stats]
  );

  const { year: chartYear, month: chartMonth, daysInMonth: chartDaysInMonth } = useMemo(() => getCurrentMonthParis(), []);

  const chartData = useMemo(() => {
    const dueKeys = [...new Set(due.map((r) => r.canonical_key))];
    if (dueKeys.length === 0) return [];
    const yearMonth = `${chartYear}-${String(chartMonth).padStart(2, "0")}`;
    const byWordByDayOfMonth = new Map<string, Map<number, number>>();
    for (const key of dueKeys) byWordByDayOfMonth.set(key, new Map());
    for (const e of reviewEvents) {
      if (!e.correct) continue;
      const day = dayKeyParis(new Date(e.reviewed_at));
      if (day.slice(0, 7) !== yearMonth) continue;
      const dayOfMonth = parseInt(day.slice(8, 10), 10);
      const m = byWordByDayOfMonth.get(e.canonical_key);
      if (m) m.set(dayOfMonth, (m.get(dayOfMonth) || 0) + 1);
    }
    const cumul: Record<string, number> = {};
    for (const k of dueKeys) cumul[k] = 0;
    const out: Array<{ dayIndex: number; dayLabel: string; total: number }> = [];
    for (let d = 1; d <= chartDaysInMonth; d++) {
      for (const k of dueKeys) cumul[k] += byWordByDayOfMonth.get(k)?.get(d) || 0;
      const total = dueKeys.reduce((s, k) => s + (cumul[k] ?? 0), 0);
      out.push({
        dayIndex: d,
        dayLabel: `${String(d).padStart(2, "0")}.${String(chartMonth).padStart(2, "0")}`,
        total,
      });
    }
    return out;
  }, [due, reviewEvents, chartYear, chartMonth, chartDaysInMonth]);

  const chartYMax = useMemo(() => {
    const max = Math.max(0, ...chartData.map((r) => r.total));
    return Math.max(1, max);
  }, [chartData]);

  useEffect(() => {
    bootstrap().finally(() => setLoading(false));
  }, []);

  async function bootstrap() {
    const deviceId = getDeviceId();
    await syncProgressRows(deviceId);
    await loadDeck(deviceId);
  }

  async function syncProgressRows(deviceId: string) {
    const { data: wordsRaw } = await supabase
      .from("user_words")
      .select("word, lemma, translation_ru, context_fr, context_ru, created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: true });
    const words = (wordsRaw || []) as UserWordRow[];

    const byCanonical = new Map<string, UserWordRow>();
    for (const w of words) {
      const key = canonicalKey(w.word, w.lemma);
      if (!byCanonical.has(key)) byCanonical.set(key, w);
    }

    const sampleMap: Record<string, { context_fr: string; context_ru: string | null }> = {};
    for (const [key, w] of byCanonical.entries()) {
      sampleMap[key] = { context_fr: w.context_fr, context_ru: w.context_ru };
    }
    setSamplesByCanonical(sampleMap);

    const { data: existingRaw } = await supabase
      .from("user_word_progress")
      .select("canonical_key")
      .eq("device_id", deviceId);
    const existing = new Set((existingRaw || []).map((r) => String(r.canonical_key)));

    const missingRows = [...byCanonical.entries()]
      .filter(([key]) => !existing.has(key))
      .map(([key, w]) => ({
        device_id: deviceId,
        canonical_key: key,
        display_word: w.word,
        lemma: w.lemma,
        translation_ru: w.translation_ru,
        next_review_at: new Date().toISOString(),
      }));

    if (missingRows.length > 0) {
      await supabase.from("user_word_progress").insert(missingRows);
    }
  }

  async function loadDeck(deviceId: string) {
    const nowIso = new Date().toISOString();
    const { data: allRaw } = await supabase
      .from("user_word_progress")
      .select("*")
      .eq("device_id", deviceId);

    const all = (allRaw || []) as ProgressRow[];
    const filtered = all
      .filter((r) => !r.mastered_at && (r.correct_count < KNOWS_TO_ADVANCE || r.next_review_at <= nowIso))
      .sort((a, b) => {
        const aLearning = a.correct_count < KNOWS_TO_ADVANCE ? 0 : 1;
        const bLearning = b.correct_count < KNOWS_TO_ADVANCE ? 0 : 1;
        if (aLearning !== bLearning) return aLearning - bLearning;
        return new Date(a.next_review_at).getTime() - new Date(b.next_review_at).getTime();
      });
    const byKey = new Map<string, ProgressRow>();
    for (const r of filtered) {
      if (!byKey.has(r.canonical_key)) byKey.set(r.canonical_key, r);
    }
    const dueRows = shuffle([...byKey.values()]);

    const keys = [...new Set(dueRows.map((r) => r.canonical_key))];
    if (keys.length > 0) {
      const { data: infoRows } = await supabase
        .from("word_info")
        .select("canonical_key, grammar, example_fr, example_ru")
        .in("canonical_key", keys);
      const fromDb: Record<string, WordInfo> = {};
      for (const row of infoRows || []) {
        const k = String((row as { canonical_key: string }).canonical_key);
        fromDb[k] = {
          grammar: String((row as { grammar: string | null }).grammar ?? ""),
          example_fr: String((row as { example_fr: string | null }).example_fr ?? ""),
          example_ru: String((row as { example_ru: string | null }).example_ru ?? ""),
        };
      }
      setInfoByCanonical((prev) => ({ ...prev, ...fromDb }));
    }

    setDue(dueRows);
    setCurrent(dueRows[0] || null);
    setShowAnswer(false);
    setPendingAction(null);

    const total = all.length;
    const mastered = all.filter((r) => !!r.mastered_at).length;
    setStats({ total, mastered, due: dueRows.length });

    // Load all review events for the device; chart filters by current Paris month in useMemo
    const { data: eventsRaw } = await supabase
      .from("review_events")
      .select("canonical_key, reviewed_at, correct")
      .eq("device_id", deviceId)
      .order("reviewed_at", { ascending: true });
    setReviewEvents((eventsRaw || []) as Array<{ canonical_key: string; reviewed_at: string; correct: boolean }>);
  }

  useEffect(() => {
    if (!showAnswer || !current) return;
    const key = current.canonical_key;
    if (infoByCanonical[key]) return;
    void fetchWordInfo(current);
  }, [showAnswer, current, infoByCanonical]);

  useEffect(() => {
    if (pendingAction !== "know" || !current) return;
    const t = setTimeout(() => {
      answerCard(true);
    }, 2000);
    return () => clearTimeout(t);
  }, [pendingAction, current]);

  async function fetchWordInfo(row: ProgressRow) {
    setInfoLoading(true);
    try {
      const sample = samplesByCanonical[row.canonical_key];
      const res = await fetch("/api/word-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: row.display_word,
          lemma: row.lemma,
          translationRu: row.translation_ru,
          contextFr: sample?.context_fr || "",
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as WordInfo;
      const info: WordInfo = {
        grammar: data.grammar || "",
        example_fr: data.example_fr || sample?.context_fr || "",
        example_ru: data.example_ru || sample?.context_ru || "",
      };
      setInfoByCanonical((prev) => ({ ...prev, [row.canonical_key]: info }));
      await supabase.from("word_info").upsert(
        {
          canonical_key: row.canonical_key,
          grammar: info.grammar,
          example_fr: info.example_fr,
          example_ru: info.example_ru,
        },
        { onConflict: "canonical_key" }
      );
    } finally {
      setInfoLoading(false);
    }
  }

  async function answerCard(correct: boolean) {
    if (!current) return;
    const deviceId = getDeviceId();
    const nowIso = new Date().toISOString();
    const stage = current.review_stage ?? 0;
    let correctCount = correct ? current.correct_count + 1 : 0;
    let nextReviewAt = nowIso;
    let masteredAt: string | null = null;
    let newStage = stage;

    if (correct && correctCount >= KNOWS_TO_ADVANCE) {
      if (stage === 0) {
        nextReviewAt = addDaysIso(7);
        correctCount = 0;
        newStage = 1;
      } else if (stage === 1) {
        nextReviewAt = addDaysIso(30);
        correctCount = 0;
        newStage = 2;
      } else {
        masteredAt = nowIso;
        nextReviewAt = nowIso;
      }
    }

    await supabase
      .from("user_word_progress")
      .update({
        correct_count: correctCount,
        last_reviewed_at: nowIso,
        next_review_at: nextReviewAt,
        mastered_at: masteredAt,
        review_stage: newStage,
        updated_at: nowIso,
      })
      .eq("id", current.id);

    await supabase.from("review_events").insert({
      device_id: deviceId,
      canonical_key: current.canonical_key,
      reviewed_at: nowIso,
      correct,
    });

    setShowAnswer(false);
    setPendingAction(null);
    const rest = due.filter((w) => w.canonical_key !== current.canonical_key);
    if (masteredAt) {
      const nextDue = rest;
      setDue(nextDue);
      setCurrent(nextDue[0] ?? null);
      setStats((s) => ({ ...s, due: nextDue.length, mastered: s.mastered + 1 }));
      if (nextDue.length === 0) await loadDeck(deviceId);
    } else if (due.length > 1) {
      const nextDue = [...due.slice(1), due[0]];
      setDue(nextDue);
      setCurrent(nextDue[0]);
    } else {
      await loadDeck(deviceId);
    }
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-4 gap-2 max-w-lg">
          <Kpi value={String(stats.total)} label="Total" />
          <Kpi value={String(stats.due)} label="Due" />
          <Kpi value={String(stats.mastered)} label="Mastered" />
          <Kpi value={progressText} label="Mastery" />
        </div>

        {loading ? (
          <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-500">Loading cards...</div>
        ) : !current ? (
          <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600">
            No due words right now. Great job.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-6">
              <div className="text-sm text-gray-500 mb-2">Front</div>
              <div className="text-4xl font-bold">{current.display_word}</div>
              {current.lemma && current.lemma.trim().toLowerCase() !== current.display_word.trim().toLowerCase() && (
                <div className="text-lg text-gray-500 mt-2">Base form: {current.lemma.trim()}</div>
              )}
            </div>

            {showAnswer && (
              <div className="bg-gray-50 rounded-xl p-6">
                <div className="text-sm text-gray-500 mb-2">Back</div>
                <div className="text-2xl">{current.translation_ru || "—"}</div>
                {infoByCanonical[current.canonical_key]?.grammar && (
                  <div className="mt-4 text-base text-gray-700">
                    <span className="text-gray-500">Grammar: </span>
                    {infoByCanonical[current.canonical_key]?.grammar}
                  </div>
                )}
                {(infoByCanonical[current.canonical_key]?.example_fr ||
                  infoByCanonical[current.canonical_key]?.example_ru) && (
                  <div className="mt-3 text-base">
                    <div className="text-gray-500">Example:</div>
                    {infoByCanonical[current.canonical_key]?.example_fr && (
                      <div className="text-gray-800">{infoByCanonical[current.canonical_key]?.example_fr}</div>
                    )}
                    {infoByCanonical[current.canonical_key]?.example_ru && (
                      <div className="text-gray-600">{infoByCanonical[current.canonical_key]?.example_ru}</div>
                    )}
                  </div>
                )}
                {infoLoading && !infoByCanonical[current.canonical_key] && (
                  <div className="mt-3 text-sm text-gray-500">Loading grammar and example...</div>
                )}
              </div>
            )}

            <div className="flex gap-3 flex-wrap">
              {!showAnswer ? (
                <>
                  <button
                    onClick={() => {
                      setShowAnswer(true);
                      setPendingAction("dontknow");
                    }}
                    className="rounded-xl px-6 py-4 bg-gray-200 text-gray-800 text-lg font-medium min-h-[52px] flex-1 min-w-[140px]"
                  >
                    Don&apos;t know
                  </button>
                  <button
                    onClick={() => {
                      setShowAnswer(true);
                      setPendingAction("know");
                    }}
                    className="rounded-xl px-6 py-4 bg-gray-900 text-white text-lg font-medium min-h-[52px] flex-1 min-w-[140px]"
                  >
                    Know
                  </button>
                </>
              ) : pendingAction === "dontknow" ? (
                <button
                  onClick={() => answerCard(false)}
                  className="rounded-xl px-6 py-4 bg-gray-900 text-white text-lg font-medium min-h-[52px] min-w-[160px]"
                >
                  Next
                </button>
              ) : (
                <span className="text-gray-500 text-sm py-2">Next word in 2 sec...</span>
              )}
            </div>

            {chartMounted && chartData.length > 0 && (
              <div className="mt-6">
                <div className="text-sm text-gray-600 mb-2">
                  Cumulative &quot;Know&quot; count by day — {chartYear}-{String(chartMonth).padStart(2, "0")}
                </div>
                <div className="w-full" style={{ width: "100%", height: 224, minHeight: 224 }}>
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 24 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="dayIndex"
                        type="number"
                        domain={[1, chartDaysInMonth]}
                        tick={{ fontSize: 10 }}
                        ticks={[1, Math.ceil(chartDaysInMonth / 4), Math.ceil(chartDaysInMonth / 2), Math.ceil((3 * chartDaysInMonth) / 4), chartDaysInMonth]}
                        tickFormatter={(v) => chartData[Number(v) - 1]?.dayLabel ?? ""}
                      />
                      <YAxis width={24} tick={{ fontSize: 10 }} allowDecimals={false} domain={[0, chartYMax]} />
                      <Tooltip
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.dayLabel ?? ""}
                        formatter={(value) => [value, "Cumulative Know"]}
                      />
                      <Bar dataKey="total" name="Know" fill="#22c55e" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-2.5 py-3">
      <div className="text-lg font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  );
}
