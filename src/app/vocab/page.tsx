"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

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
const INTERVAL_DAYS = [1, 2, 4, 7, 10, 14, 21, 30, 45, 60];
const TZ = "Europe/Paris";

function canonicalKey(word: string, lemma: string | null) {
  return (lemma || word).trim().toLowerCase();
}

function todayKeyParis(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
  let y = get("year");
  let m = get("month");
  let d = get("day");
  const h = get("hour");
  if (h < 2) {
    const prev = new Date(Date.UTC(y, m - 1, d) - DAY_MS);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysIso(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export default function VocabPage() {
  const [due, setDue] = useState<ProgressRow[]>([]);
  const [current, setCurrent] = useState<ProgressRow | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, mastered: 0, due: 0 });
  const [samplesByCanonical, setSamplesByCanonical] = useState<
    Record<string, { context_fr: string; context_ru: string | null }>
  >({});
  const [infoByCanonical, setInfoByCanonical] = useState<Record<string, WordInfo>>({});
  const [infoLoading, setInfoLoading] = useState(false);

  const progressText = useMemo(
    () => (stats.total === 0 ? "0%" : `${Math.round((stats.mastered / stats.total) * 100)}%`),
    [stats]
  );

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
    const [{ data: dueRaw }, { data: allRaw }] = await Promise.all([
      supabase
        .from("user_word_progress")
        .select("*")
        .eq("device_id", deviceId)
        .is("mastered_at", null)
        .lte("next_review_at", nowIso)
        .order("next_review_at", { ascending: true }),
      supabase.from("user_word_progress").select("id, mastered_at").eq("device_id", deviceId),
    ]);

    const dueRows = (dueRaw || []) as ProgressRow[];
    setDue(dueRows);
    setCurrent(dueRows[0] || null);
    setShowAnswer(false);

    const total = (allRaw || []).length;
    const mastered = (allRaw || []).filter((r) => !!r.mastered_at).length;
    setStats({ total, mastered, due: dueRows.length });
  }

  useEffect(() => {
    if (!showAnswer || !current) return;
    const key = current.canonical_key;
    if (infoByCanonical[key]) return;
    void fetchWordInfo(current);
  }, [showAnswer, current, infoByCanonical]);

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
      setInfoByCanonical((prev) => ({
        ...prev,
        [row.canonical_key]: {
          grammar: data.grammar || "",
          example_fr: data.example_fr || sample?.context_fr || "",
          example_ru: data.example_ru || sample?.context_ru || "",
        },
      }));
    } finally {
      setInfoLoading(false);
    }
  }

  async function answerCard(correct: boolean) {
    if (!current) return;
    const deviceId = getDeviceId();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayKey = todayKeyParis(now);

    let correctCount = current.correct_count;
    let correctDays = current.correct_days;
    let lastCorrectDay = current.last_correct_day;
    let masteredAt: string | null = null;
    let nextReviewAt = addDaysIso(1);

    if (correct) {
      if (lastCorrectDay !== todayKey) {
        correctDays += 1;
        lastCorrectDay = todayKey;
      }
      correctCount += 1;

      if (correctCount >= 10) {
        if (correctDays <= 1) {
          // Crammed in one day -> one delayed check in a month.
          correctCount = 9;
          nextReviewAt = addDaysIso(30);
        } else if (correctDays <= 3) {
          // Still too compressed -> one delayed check in a week.
          correctCount = 9;
          nextReviewAt = addDaysIso(7);
        } else {
          masteredAt = nowIso;
          nextReviewAt = nowIso;
        }
      } else {
        const interval = INTERVAL_DAYS[Math.min(correctCount - 1, INTERVAL_DAYS.length - 1)];
        nextReviewAt = addDaysIso(interval);
      }
    } else {
      correctCount = 0;
      nextReviewAt = addDaysIso(1);
    }

    await supabase
      .from("user_word_progress")
      .update({
        correct_count: correctCount,
        correct_days: correctDays,
        last_correct_day: correct ? lastCorrectDay : current.last_correct_day,
        last_reviewed_at: nowIso,
        next_review_at: nextReviewAt,
        mastered_at: masteredAt,
        updated_at: nowIso,
      })
      .eq("id", current.id);

    await loadDeck(deviceId);
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-3xl font-bold">Words</h1>
        <p className="text-base opacity-70">
          Review cards • Learned {stats.mastered}/{stats.total} • Mastery {progressText}
        </p>

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
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Front</div>
              <div className="text-2xl font-bold">{current.display_word}</div>
            </div>

            {showAnswer && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">Back</div>
                <div className="text-lg">{current.translation_ru || "—"}</div>
                {infoByCanonical[current.canonical_key]?.grammar && (
                  <div className="mt-3 text-sm text-gray-700">
                    <span className="text-gray-500">Grammar: </span>
                    {infoByCanonical[current.canonical_key]?.grammar}
                  </div>
                )}
                {(infoByCanonical[current.canonical_key]?.example_fr ||
                  infoByCanonical[current.canonical_key]?.example_ru) && (
                  <div className="mt-2 text-sm">
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
                  <div className="mt-2 text-xs text-gray-500">Loading grammar and example...</div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {!showAnswer ? (
                <button
                  onClick={() => setShowAnswer(true)}
                  className="rounded-lg px-4 py-2 bg-gray-900 text-white text-sm font-medium"
                >
                  Show answer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => answerCard(false)}
                    className="rounded-lg px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium"
                  >
                    I did not know
                  </button>
                  <button
                    onClick={() => answerCard(true)}
                    className="rounded-lg px-4 py-2 bg-gray-900 text-white text-sm font-medium"
                  >
                    I knew it
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-gray-50 p-2 rounded-lg">
      <div className="text-xl font-bold text-gray-800 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
