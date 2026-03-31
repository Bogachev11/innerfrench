"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { RequireAuth } from "@/lib/RequireAuth";

/** Один общий прогресс в Supabase для всех устройств */
const PROGRESS_DEVICE_ID = "default";

type ProgressRow = {
  id: string;
  device_id: string;
  canonical_key: string;
  display_word: string;
  lemma: string | null;
  translation_ru: string | null;
  translation_ru_2?: string | null;
  translation_ru_3?: string | null;
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
  translation_ru_2?: string | null;
  translation_ru_3?: string | null;
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

const VOCAB_SHOWN_PREFIX = "vocab_shown_";
function getShownTodayKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = VOCAB_SHOWN_PREFIX + dayKeyParis(new Date());
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}
function addShownToday(canonicalKey: string) {
  if (typeof window === "undefined") return;
  try {
    const dayKey = dayKeyParis(new Date());
    const storageKey = VOCAB_SHOWN_PREFIX + dayKey;
    const list: string[] = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!list.includes(canonicalKey)) list.push(canonicalKey);
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {}
}

export default function VocabPage() {
  const [due, setDue] = useState<ProgressRow[]>([]);
  const [current, setCurrent] = useState<ProgressRow | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, mastered: 0, due: 0 });
  const [samplesByCanonical, setSamplesByCanonical] = useState<
    Record<string, { context_fr: string; context_ru: string | null }>
  >({});
  const [infoByCanonical, setInfoByCanonical] = useState<Record<string, WordInfo>>({});
  const [reviewEvents, setReviewEvents] = useState<Array<{ canonical_key: string; reviewed_at: string; correct: boolean }>>([]);
  const [allProgress, setAllProgress] = useState<ProgressRow[]>([]);
  const [wordCreatedAtByKey, setWordCreatedAtByKey] = useState<Record<string, string>>({});
  const [shownInRound, setShownInRound] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (current) addShownToday(current.canonical_key);
  }, [current?.canonical_key]);

  const progressText = useMemo(
    () => (stats.total === 0 ? "0%" : `${Math.round((stats.mastered / stats.total) * 100)}%`),
    [stats]
  );

  useEffect(() => {
    bootstrap().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      syncProgressRows(PROGRESS_DEVICE_ID).then(() => loadDeck(PROGRESS_DEVICE_ID));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function bootstrap() {
    await syncProgressRows(PROGRESS_DEVICE_ID);
    await loadDeck(PROGRESS_DEVICE_ID);
    // Если прогресс пустой, но слова в user_words есть — повторная попытка синхронизации
    const { data: progressCheck } = await supabase
      .from("user_word_progress")
      .select("id")
      .eq("device_id", PROGRESS_DEVICE_ID)
      .limit(1);
    const hasProgress = progressCheck && progressCheck.length > 0;
    const { count: wordsCount } = await supabase
      .from("user_words")
      .select("id", { count: "exact", head: true });
    if (!hasProgress && (wordsCount ?? 0) > 0) {
      await syncProgressRows(PROGRESS_DEVICE_ID);
      await loadDeck(PROGRESS_DEVICE_ID);
    }
  }

  async function syncProgressRows(_deviceId: string) {
    // Load all saved words from Supabase (no device filter — one shared pool)
    // Только колонки из базовой схемы (003); без order — совместимость с разными версиями API
    const { data: wordsRaw } = await supabase
      .from("user_words")
      .select("word, lemma, translation_ru, context_fr, context_ru, created_at");
    const words = (wordsRaw || []) as UserWordRow[];
    words.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const byCanonical = new Map<string, UserWordRow>();
    const createdByKey: Record<string, string> = {};
    for (const w of words) {
      const key = canonicalKey(w.word, w.lemma);
      if (!byCanonical.has(key)) byCanonical.set(key, w);
      if (!createdByKey[key] || w.created_at < createdByKey[key]) createdByKey[key] = w.created_at;
    }
    setWordCreatedAtByKey(createdByKey);

    const sampleMap: Record<string, { context_fr: string; context_ru: string | null }> = {};
    for (const [key, w] of byCanonical.entries()) {
      sampleMap[key] = { context_fr: w.context_fr, context_ru: w.context_ru };
    }
    setSamplesByCanonical(sampleMap);

    const { data: existingRaw } = await supabase
      .from("user_word_progress")
      .select("canonical_key")
      .eq("device_id", PROGRESS_DEVICE_ID);
    const existing = new Set((existingRaw || []).map((r) => String(r.canonical_key)));

    // Лучший прогресс по каждому слову (из любых device_id) — чтобы не терять пройденное
    const { data: allProgressRaw } = await supabase
      .from("user_word_progress")
      .select("canonical_key, correct_count, mastered_at, next_review_at");
    const bestByKey = new Map<string, { correct_count: number; mastered_at: string | null; next_review_at: string }>();
    for (const row of allProgressRaw || []) {
      const key = String(row.canonical_key);
      const cur = bestByKey.get(key);
      const count = Number(row.correct_count ?? 0);
      const mastered = row.mastered_at ? String(row.mastered_at) : null;
      const next = String(row.next_review_at ?? new Date().toISOString());
      if (!cur || count > cur.correct_count || (mastered && !cur.mastered_at)) {
        bestByKey.set(key, { correct_count: count, mastered_at: mastered, next_review_at: next });
      }
    }

    const nowIso = new Date().toISOString();
    const defaultProgress = { correct_count: 0, mastered_at: null as string | null, next_review_at: nowIso };

    // Только колонки из базовой схемы (004)
    const missingRows = [...byCanonical.entries()]
      .filter(([key]) => !existing.has(key))
      .map(([key, w]) => {
        const best = bestByKey.get(key) ?? defaultProgress;
        return {
          device_id: PROGRESS_DEVICE_ID,
          canonical_key: key,
          display_word: w.word,
          lemma: w.lemma,
          translation_ru: w.translation_ru,
          next_review_at: best.next_review_at,
          correct_count: best.correct_count,
          mastered_at: best.mastered_at,
        };
      });

    const BATCH = 50;
    for (let i = 0; i < missingRows.length; i += BATCH) {
      const batch = missingRows.slice(i, i + BATCH);
      const { error } = await supabase.from("user_word_progress").insert(batch);
      if (error) console.error("syncProgressRows insert batch:", error.message);
    }

    // Подтянуть лучший прогресс в строки default, где сейчас прогресс ниже
    const { data: defaultRows } = await supabase
      .from("user_word_progress")
      .select("canonical_key, correct_count, mastered_at")
      .eq("device_id", PROGRESS_DEVICE_ID);
    for (const row of defaultRows || []) {
      const key = String(row.canonical_key);
      const best = bestByKey.get(key);
      if (!best) continue;
      const curCount = Number(row.correct_count ?? 0);
      if (best.correct_count > curCount || (best.mastered_at && !row.mastered_at)) {
        await supabase
          .from("user_word_progress")
          .update({
            correct_count: Math.max(curCount, best.correct_count),
            mastered_at: best.mastered_at ?? row.mastered_at,
            next_review_at: best.next_review_at,
            updated_at: nowIso,
          })
          .eq("device_id", PROGRESS_DEVICE_ID)
          .eq("canonical_key", key);
      }
    }
  }

  async function loadDeck(_deviceId: string) {
    const nowIso = new Date().toISOString();
    const { data: allRaw } = await supabase
      .from("user_word_progress")
      .select("*")
      .eq("device_id", PROGRESS_DEVICE_ID);

    let all = (allRaw || []) as ProgressRow[];
    const stuck = all.filter((r) => !r.mastered_at && r.correct_count >= KNOWS_TO_ADVANCE);
    for (const r of stuck) {
      await supabase
        .from("user_word_progress")
        .update({
          mastered_at: nowIso,
          next_review_at: addDaysIso(7),
          updated_at: nowIso,
        })
        .eq("device_id", PROGRESS_DEVICE_ID)
        .eq("canonical_key", r.canonical_key);
    }
    if (stuck.length > 0) {
      const { data: refetched } = await supabase
        .from("user_word_progress")
        .select("*")
        .eq("device_id", PROGRESS_DEVICE_ID);
      all = (refetched || []) as ProgressRow[];
    }
    const isDue = (r: ProgressRow) => {
      if (!r.mastered_at && r.correct_count >= KNOWS_TO_ADVANCE) return false;
      return !r.mastered_at || r.next_review_at <= nowIso;
    };
    const filtered = all
      .filter((r) => isDue(r))
      .sort((a, b) => {
        const aLearning = a.mastered_at ? 1 : (a.correct_count < KNOWS_TO_ADVANCE ? 0 : 1);
        const bLearning = b.mastered_at ? 1 : (b.correct_count < KNOWS_TO_ADVANCE ? 0 : 1);
        if (aLearning !== bLearning) return aLearning - bLearning;
        return new Date(a.next_review_at).getTime() - new Date(b.next_review_at).getTime();
      });
    const byKey = new Map<string, ProgressRow>();
    for (const r of filtered) {
      if (!byKey.has(r.canonical_key)) byKey.set(r.canonical_key, r);
    }
    const shownToday = new Set(getShownTodayKeys());
    const notShownToday = [...byKey.values()].filter((r) => !shownToday.has(r.canonical_key));
    const dueRows = shuffle(notShownToday);

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
    const first = dueRows[0] || null;
    setCurrent(first);
    setFlipped(false);
    setAllProgress(all);
    setShownInRound(first ? new Set([first.canonical_key]) : new Set());
    if (first) addShownToday(first.canonical_key);

    const total = all.length;
    const mastered = all.filter((r) => !!r.mastered_at).length;
    setStats({ total, mastered, due: dueRows.length });

    // Review events со всех устройств — чтобы график показывал всю историю «одобрено»
    const { data: eventsRaw } = await supabase
      .from("review_events")
      .select("canonical_key, reviewed_at, correct")
      .order("reviewed_at", { ascending: true });
    setReviewEvents((eventsRaw || []) as Array<{ canonical_key: string; reviewed_at: string; correct: boolean }>);
  }

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (!flipped) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        answerCard(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        answerCard(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, current]);

  async function answerCard(correct: boolean) {
    if (!current) return;
    addShownToday(current.canonical_key);
    const nowIso = new Date().toISOString();
    const alreadyMastered = !!current.mastered_at;

    let correctCount: number;
    let nextReviewAt = nowIso;
    let masteredAt: string | null = current.mastered_at;

    if (alreadyMastered) {
      correctCount = current.correct_count;
      nextReviewAt = addDaysIso(30);
    } else {
      const { count: eventCount } = await supabase
        .from("review_events")
        .select("*", { count: "exact", head: true })
        .eq("device_id", PROGRESS_DEVICE_ID)
        .eq("canonical_key", current.canonical_key)
        .eq("correct", true);
      const fromEvents = (eventCount ?? 0) + (correct ? 1 : 0);
      correctCount = correct
        ? Math.max(current.correct_count + 1, fromEvents)
        : 0;
      const shouldMaster = correct && correctCount >= KNOWS_TO_ADVANCE;
      if (shouldMaster) {
        masteredAt = nowIso;
        nextReviewAt = addDaysIso(7);
      }
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from("user_word_progress")
      .update({
        correct_count: correctCount,
        last_reviewed_at: nowIso,
        next_review_at: nextReviewAt,
        mastered_at: masteredAt,
        updated_at: nowIso,
      })
      .eq("id", current.id)
      .select("id");

    if (updateErr || (masteredAt && (!updatedRows || updatedRows.length === 0))) {
      setFlipped(false);
      await loadDeck(PROGRESS_DEVICE_ID);
      return;
    }

    await supabase.from("review_events").insert({
      device_id: PROGRESS_DEVICE_ID,
      canonical_key: current.canonical_key,
      reviewed_at: nowIso,
      correct,
    });

    setFlipped(false);
    const updatedRow: ProgressRow = {
      ...current,
      correct_count: correctCount,
      next_review_at: nextReviewAt,
      mastered_at: masteredAt,
    };
    setAllProgress((prev) =>
      prev.map((r) => (r.canonical_key === current.canonical_key ? updatedRow : r))
    );
    const rest = due.filter((w) => w.canonical_key !== current.canonical_key);
    const newShown = new Set(shownInRound);
    newShown.add(current.canonical_key);

    const pickNext = (candidates: ProgressRow[]): ProgressRow | null => {
      if (candidates.length === 0) return null;
      const notShown = candidates.filter((r) => !newShown.has(r.canonical_key));
      if (notShown.length > 0) {
        setShownInRound(newShown);
        return shuffle(notShown)[0];
      }
      const next = candidates[0];
      setShownInRound(next ? new Set([next.canonical_key]) : new Set());
      return next;
    };

    if (masteredAt && !current.mastered_at) {
      setDue(rest);
      const next = pickNext(rest);
      setCurrent(next);
      if (next) addShownToday(next.canonical_key);
      setStats((s) => ({ ...s, due: rest.length, mastered: s.mastered + 1 }));
    } else if (due.length > 1) {
      const nextDue = [...due.slice(1), updatedRow];
      setDue(nextDue);
      const next = pickNext(nextDue);
      setCurrent(next);
      if (next) addShownToday(next.canonical_key);
    } else {
      await loadDeck(PROGRESS_DEVICE_ID);
    }
  }

  async function deleteWord(row: ProgressRow) {
    setFlipped(false);
    const q = supabase.from("user_words").delete().eq("word", row.display_word);
    await (row.lemma != null ? q.eq("lemma", row.lemma) : q.is("lemma", null));
    await supabase
      .from("user_word_progress")
      .delete()
      .eq("device_id", PROGRESS_DEVICE_ID)
      .eq("canonical_key", row.canonical_key);
    await loadDeck(PROGRESS_DEVICE_ID);
  }

  return (
    <RequireAuth>
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
            <VocabCard
              current={current}
              info={infoByCanonical[current.canonical_key]}
              sample={samplesByCanonical[current.canonical_key]}
              flipped={flipped}
              onFlip={() => setFlipped(true)}
              onSwipeLeft={() => answerCard(false)}
              onSwipeRight={() => answerCard(true)}
              onDelete={() => deleteWord(current)}
            />

          </div>
        )}
      </main>
    </div>
    </RequireAuth>
  );
}

const SWIPE_THRESHOLD = 60;
const ANIM_MS = 320;

function isFrenchForm(s: string): boolean {
  return /^[\p{L}\s'’-]+$/u.test(s.trim()) && !/[\u0400-\u04FF]/.test(s);
}

function VocabCard({
  current,
  info,
  sample,
  flipped,
  onFlip,
  onSwipeLeft,
  onSwipeRight,
  onDelete,
}: {
  current: ProgressRow;
  info: WordInfo | undefined;
  sample: { context_fr: string; context_ru: string | null } | undefined;
  flipped: boolean;
  onFlip: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onDelete: () => void;
}) {
  const touchStartX = useRef(0);
  const exitFiredRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const [exitForKey, setExitForKey] = useState<string | null>(null);
  const flyOffPx = typeof window !== "undefined" ? Math.max(400, window.innerWidth * 0.6) : 500;

  useEffect(() => {
    setExitDir(null);
    setExitForKey(null);
    setDragX(0);
    exitFiredRef.current = false;
  }, [current.canonical_key]);

  const exampleFr = info?.example_fr || sample?.context_fr || "";
  const exampleRu = info?.example_ru || sample?.context_ru || "";

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName !== "transform") return;
    if (exitFiredRef.current) return;
    exitFiredRef.current = true;
    if (exitDir === "right") onSwipeRight();
    else if (exitDir === "left") onSwipeLeft();
  };

  const isExiting = exitDir !== null && exitForKey === current.canonical_key;
  const translateX = isExiting ? (exitDir === "right" ? 1 : -1) * flyOffPx : dragX;
  const rotate = isExiting ? (exitDir === "right" ? 12 : -12) : dragX * 0.03;
  const scale = isExiting ? 0.88 : 1;
  const opacity = isExiting ? 0.6 : 1;
  const tint = exitDir === "right" ? "rgba(34,197,94,0.3)" : exitDir === "left" ? "rgba(239,68,68,0.3)" : dragX > 30 ? "rgba(34,197,94,0.12)" : dragX < -30 ? "rgba(239,68,68,0.12)" : "transparent";

  return (
    <div
      className="relative w-full cursor-pointer select-none overflow-hidden"
      style={{ minHeight: 320 }}
      onClick={() => !flipped && !isExiting && onFlip()}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? 0;
        setDragX(0);
      }}
      onTouchMove={(e) => {
        if (!flipped) return;
        const x = e.touches[0]?.clientX ?? 0;
        setDragX(Math.max(-flyOffPx * 0.5, Math.min(flyOffPx * 0.5, x - touchStartX.current)));
      }}
      onTouchEnd={(e) => {
        if (!flipped) {
          e.preventDefault();
          onFlip();
          return;
        }
        const endX = e.changedTouches[0]?.clientX ?? 0;
        const dx = endX - touchStartX.current;
        if (dx > SWIPE_THRESHOLD) {
          e.preventDefault();
          setExitForKey(current.canonical_key);
          setExitDir("right");
        } else if (dx < -SWIPE_THRESHOLD) {
          e.preventDefault();
          setExitForKey(current.canonical_key);
          setExitDir("left");
        } else {
          setDragX(0);
        }
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl will-change-transform"
        style={{
          transform: `translateX(${translateX}px) rotate(${rotate}deg) scale(${scale})`,
          opacity,
          transition: isExiting
            ? `transform ${ANIM_MS}ms cubic-bezier(0.34, 1.2, 0.64, 1), opacity ${ANIM_MS}ms ease-out`
            : "transform 150ms ease-out",
        }}
        onTransitionEnd={isExiting ? handleTransitionEnd : undefined}
      >
        <div
          className="absolute inset-0 w-full rounded-2xl bg-gray-50 p-6 flex flex-col justify-center items-center transition-opacity duration-200"
          style={{
            opacity: flipped ? 0 : 1,
            pointerEvents: flipped ? "none" : "auto",
            backgroundColor: dragX > 20 ? "rgb(240 253 244)" : dragX < -20 ? "rgb(254 226 226)" : undefined,
          }}
          aria-hidden={flipped}
        >
          <div className="text-4xl md:text-5xl font-bold text-gray-900 text-center">
            {current.display_word}
          </div>
        </div>
        <div
          className="absolute inset-0 w-full rounded-2xl bg-gray-100 p-6 flex flex-col transition-opacity duration-200"
          style={{
            opacity: flipped ? 1 : 0,
            pointerEvents: flipped ? "auto" : "none",
            backgroundColor: dragX > 20 ? "rgb(240 253 244)" : dragX < -20 ? "rgb(254 226 226)" : undefined,
          }}
          aria-hidden={!flipped}
        >
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ backgroundColor: tint }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-3 right-12 z-20 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            aria-label=""
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
          <div className="absolute top-0 right-0 bottom-0 w-2 rounded-r-2xl bg-gray-200 z-10 overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 rounded-br-2xl transition-all duration-300"
              style={{
                height: `${(current.correct_count / KNOWS_TO_ADVANCE) * 100}%`,
                background: "linear-gradient(to top, #dc2626, #eab308)",
              }}
            />
          </div>
          <div className="relative z-10">
            <div className="text-sm text-gray-500 mb-1">{current.display_word}</div>
            {current.lemma && current.lemma !== current.display_word && isFrenchForm(current.lemma) && (
              <div className="text-lg text-gray-600 mb-2 font-medium">{current.lemma}</div>
            )}
            <div className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
              {current.translation_ru || "—"}
            </div>
            {(current.translation_ru_2 || current.translation_ru_3) && (
              <div className="text-sm text-gray-600 mb-2">
                {[current.translation_ru_2, current.translation_ru_3].filter(Boolean).join("; ")}
              </div>
            )}
            {(exampleFr || exampleRu) ? (
              <div className="text-base text-gray-700 mb-2">
                {exampleFr && <div className="text-gray-800">{exampleFr}</div>}
                {exampleRu && <div className="text-gray-600">{exampleRu}</div>}
              </div>
            ) : null}
            {info?.grammar ? (
              <div className="text-sm text-gray-500 mt-auto">{info.grammar}</div>
            ) : null}
          </div>
        </div>
      </div>
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
