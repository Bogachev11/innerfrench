"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { Episode, Segment } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

const REFLEXIVE = new Set(["se", "me", "te", "nous", "vous"]);

function getWordTokens(text: string): string[] {
  const tokens = text.match(/[\p{L}][\p{L}'’-]*|[^\p{L}]+/gu) ?? [];
  return tokens.filter((t) => /^[\p{L}][\p{L}'’-]*$/u.test(t));
}

interface WordPanelState {
  segmentId: string;
  contextFr: string;
  contextRu: string | null;
  wordTokens: string[];
  startIdx: number;
  endIdx: number;
  /** When set, phrase is from text selection (finger), not Prev/Next */
  selectedPhrase?: string;
}

interface SelectionBarState {
  segmentId: string;
  contextFr: string;
  contextRu: string | null;
  selectedText: string;
}

interface WordTranslation {
  translation: string;
  lemma: string;
  short_note: string;
  translation_2?: string;
  translation_3?: string;
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function EpisodePlayer({
  episode,
  segments,
}: {
  episode: Episode;
  segments: Segment[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef<string | null>(null);
  const sessionStart = useRef(0);
  const lastSavedMs = useRef(0);
  const currentMsRef = useRef(0);
  const playingRef = useRef(false);
  const durationRef = useRef(episode.duration_sec ? episode.duration_sec * 1000 : 0);

  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(durationRef.current);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wordPanel, setWordPanel] = useState<WordPanelState | null>(null);
  const [wordTranslation, setWordTranslation] = useState<WordTranslation | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [wordSaveMsg, setWordSaveMsg] = useState("");
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [selectionBar, setSelectionBar] = useState<SelectionBarState | null>(null);

  // Keep refs in sync with state
  useEffect(() => { currentMsRef.current = currentMs; }, [currentMs]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const activeIdx = segments.findIndex(
    (s, i) =>
      currentMs >= s.start_ms &&
      (s.end_ms ? currentMs < s.end_ms : i === segments.length - 1 || currentMs < (segments[i + 1]?.start_ms ?? Infinity))
  );

  useEffect(() => {
    if (autoScroll && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIdx, autoScroll]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { const ms = audio.currentTime * 1000; currentMsRef.current = ms; setCurrentMs(ms); };
    const onDur = () => { const ms = audio.duration * 1000; durationRef.current = ms; setDuration(ms); };
    const onPlay = () => { playingRef.current = true; setPlaying(true); };
    const onPause = () => { playingRef.current = false; setPlaying(false); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  // Start session on play, close on pause
  useEffect(() => {
    if (playing && !sessionId.current) {
      const deviceId = getDeviceId();
      sessionStart.current = Date.now();
      lastSavedMs.current = currentMsRef.current;
      supabase
        .from("listening_sessions")
        .insert({
          episode_id: episode.id,
          device_id: deviceId,
          started_at: new Date().toISOString(),
          start_position_ms: Math.round(currentMsRef.current),
        })
        .select("id")
        .single()
        .then(({ data }) => {
          if (data) sessionId.current = data.id;
        });
    }
    if (!playing && sessionId.current) {
      closeSession();
    }
  }, [playing]);

  function closeSession() {
    if (!sessionId.current) return;
    const listened = Date.now() - sessionStart.current;
    supabase
      .from("listening_sessions")
      .update({
        ended_at: new Date().toISOString(),
        end_position_ms: Math.round(currentMsRef.current),
        listened_ms: listened,
      })
      .eq("id", sessionId.current)
      .then(() => {});
    saveProgress();
    sessionId.current = null;
  }

  useEffect(() => () => closeSession(), []);

  async function saveProgress() {
    const deviceId = getDeviceId();
    const pos = Math.round(currentMsRef.current);
    const dur = durationRef.current;
    const delta = Math.max(0, pos - lastSavedMs.current);
    lastSavedMs.current = pos;
    const completed = dur > 0 && pos >= dur * 0.95;

    const { data: existing } = await supabase
      .from("episode_progress")
      .select("total_listened_ms")
      .eq("episode_id", episode.id)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("episode_progress")
        .update({
          last_position_ms: pos,
          total_listened_ms: existing.total_listened_ms + delta,
          completed,
          updated_at: new Date().toISOString(),
        })
        .eq("episode_id", episode.id)
        .eq("device_id", deviceId);
    } else {
      await supabase.from("episode_progress").insert({
        episode_id: episode.id,
        device_id: deviceId,
        last_position_ms: pos,
        total_listened_ms: delta,
        completed: false,
        updated_at: new Date().toISOString(),
      });
    }
  }

  function getSelectedText(panel: WordPanelState): string {
    if (panel.selectedPhrase) return panel.selectedPhrase;
    return panel.wordTokens.slice(panel.startIdx, panel.endIdx + 1).join(" ");
  }

  function openWordPanel(token: string, seg: Segment, tokenIndex: number) {
    const wordTokens = getWordTokens(seg.fr_text ?? "");
    let startIdx = Math.max(0, Math.min(tokenIndex, wordTokens.length - 1));
    let endIdx = startIdx;
    if (REFLEXIVE.has(wordTokens[startIdx]?.toLowerCase()) && wordTokens[endIdx + 1]) endIdx += 1;
    setWordPanel({
      segmentId: seg.id,
      contextFr: seg.fr_text ?? "",
      contextRu: seg.ru_text ?? null,
      wordTokens,
      startIdx,
      endIdx,
    });
    setWordTranslation(null);
    setWordSaveMsg("");
  }

  useEffect(() => {
    if (!wordPanel) return;
    setWordLoading(true);
    const phrase = getSelectedText(wordPanel);
    fetch("/api/word-translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: phrase, contextFr: wordPanel.contextFr }),
    })
      .then((r) => r.json())
      .then((data) => {
        setWordTranslation({
          translation: data.translation || "",
          lemma: data.lemma || phrase,
          short_note: data.short_note || "",
          translation_2: data.translation_2,
          translation_3: data.translation_3,
        });
      })
      .catch(() => setWordTranslation({ translation: "Translation error", lemma: phrase, short_note: "" }))
      .finally(() => setWordLoading(false));
  }, [wordPanel?.segmentId, wordPanel?.startIdx, wordPanel?.endIdx]);

  async function saveWord() {
    if (!wordPanel || !wordTranslation) return;
    const deviceId = getDeviceId();
    const word = getSelectedText(wordPanel).toLowerCase().trim();
    if (!word) return;
    setWordSaveMsg("…");
    try {
      const payload: Record<string, unknown> = {
        device_id: deviceId,
        episode_id: episode.id,
        segment_id: wordPanel.segmentId,
        word,
        lemma: (wordTranslation.lemma || word).trim(),
        translation_ru: wordTranslation.translation,
        context_fr: wordPanel.contextFr,
        context_ru: wordPanel.contextRu,
      };
      const { error } = await supabase.from("user_words").insert(payload);
      if (error) {
        setWordSaveMsg("Error: " + (error.message || "save failed"));
        return;
      }
      setSavedWords((prev) => new Set(prev).add(word));
      setWordSaveMsg("Saved");
      setTimeout(closeWordPanel, 500);
      const lemma = (wordTranslation.lemma || word).trim().toLowerCase();
      fetch("/api/word-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word,
          lemma: wordTranslation.lemma || undefined,
          translationRu: wordTranslation.translation,
          contextFr: wordPanel.contextFr || "",
        }),
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          return supabase.from("word_info").upsert(
            { canonical_key: lemma, grammar: data.grammar ?? "", example_fr: data.example_fr ?? "", example_ru: data.example_ru ?? "" },
            { onConflict: "canonical_key" }
          );
        })
        .catch(() => {});
    } catch (e) {
      setWordSaveMsg("Error: " + (e instanceof Error ? e.message : "save failed"));
    }
  }

  function renderWordTokens(text: string, seg: Segment) {
    const tokens = text.match(/[\p{L}][\p{L}'’-]*|[^\p{L}]+/gu) ?? [text];
    let wordIdx = -1;
    return tokens.map((token, idx) => {
      if (/^[\p{L}][\p{L}'’-]*$/u.test(token)) {
        wordIdx += 1;
        const normalized = token.toLowerCase();
        const isSaved = savedWords.has(normalized);
        return (
          <button
            key={`${seg.id}_${idx}`}
            type="button"
            className={`rounded px-0.5 transition-colors hover:text-brand ${
              isSaved ? "border border-black" : "border border-transparent"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              openWordPanel(token, seg, wordIdx);
            }}
          >
            {token}
          </button>
        );
      }
      return <span key={`${seg.id}_${idx}`}>{token}</span>;
    });
  }

  // Save progress every 10s — no reactive deps, reads refs
  useEffect(() => {
    const interval = setInterval(() => {
      if (!playingRef.current) return;
      saveProgress();
    }, 10000);
    return () => clearInterval(interval);
  }, [episode.id]);

  // Restore position
  useEffect(() => {
    const deviceId = getDeviceId();
    supabase
      .from("episode_progress")
      .select("last_position_ms")
      .eq("episode_id", episode.id)
      .eq("device_id", deviceId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.last_position_ms && audioRef.current) {
          audioRef.current.currentTime = data.last_position_ms / 1000;
          setCurrentMs(data.last_position_ms);
        }
      });
  }, [episode.id]);

  // Load saved words once: marked in all podcast pages
  useEffect(() => {
    const deviceId = getDeviceId();
    supabase
      .from("user_words")
      .select("word")
      .eq("device_id", deviceId)
      .then(({ data }) => {
        if (!data) return;
        setSavedWords(new Set(data.map((r) => String(r.word).toLowerCase())));
      });
  }, []);

  const handlePointerUp = useCallback((ev: TouchEvent | MouseEvent) => {
    const target = ev.target as Node;
    if (target && (document.querySelector("[data-word-panel]")?.contains(target) || document.querySelector("[data-selection-bar]")?.contains(target))) return;
    const sel = window.getSelection();
    const text = sel?.toString?.()?.trim?.() ?? "";
    const anchor = sel?.anchorNode;
    if (!anchor) return;
    const segmentEl = (anchor as Node).nodeType === Node.ELEMENT_NODE
      ? (anchor as Element).closest("[data-segment-id]")
      : (anchor as Node).parentElement?.closest("[data-segment-id]");
    if (!segmentEl) return;
    const segmentId = (segmentEl as HTMLElement).dataset.segmentId;
    if (!segmentId) return;
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg) return;

    if (text) {
      setSelectionBar({
        segmentId,
        contextFr: seg.fr_text ?? "",
        contextRu: seg.ru_text ?? null,
        selectedText: text,
      });
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (!range?.collapsed) return;
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return;
    const offset = range.startOffset;
    const fullText = seg.fr_text ?? "";
    const tokens = fullText.match(/[\p{L}][\p{L}'’-]*|[^\p{L}]+/gu) ?? [];
    let pos = 0;
    let wordIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (/^[\p{L}][\p{L}'’-]*$/u.test(tokens[i])) wordIdx++;
      if (offset >= pos && offset < pos + tokens[i].length) {
        const token = tokens[i];
        if (/^[\p{L}][\p{L}'’-]*$/u.test(token)) {
          openWordPanel(token, seg, wordIdx);
          ev.preventDefault();
          ev.stopPropagation();
        }
        break;
      }
      pos += tokens[i].length;
    }
  }, [segments]);

  useEffect(() => {
    document.addEventListener("touchend", handlePointerUp, true);
    document.addEventListener("mouseup", handlePointerUp, true);
    return () => {
      document.removeEventListener("touchend", handlePointerUp, true);
      document.removeEventListener("mouseup", handlePointerUp, true);
    };
  }, [handlePointerUp]);

  const closeWordPanel = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelectionBar(null);
    setWordPanel(null);
    setWordSaveMsg("");
  }, []);

  function openPanelFromSelection(sel: SelectionBarState) {
    setWordPanel({
      segmentId: sel.segmentId,
      contextFr: sel.contextFr,
      contextRu: sel.contextRu,
      wordTokens: getWordTokens(sel.contextFr),
      startIdx: 0,
      endIdx: 0,
      selectedPhrase: sel.selectedText,
    });
    setWordTranslation(null);
    setWordSaveMsg("");
    window.getSelection()?.removeAllRanges();
    setSelectionBar(null);
  }

  const seek = useCallback((ms: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      setCurrentMs(ms);
    }
  }, []);

  const skip = useCallback((delta: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += delta;
    }
  }, []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }, []);

  const progress = duration > 0 ? (currentMs / duration) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-12 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-2">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <a href="/episodes" className="text-brand text-sm font-medium">←</a>
          <h1 className="text-sm font-semibold truncate flex-1">
            #{episode.number} {episode.title}
          </h1>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-1 rounded ${
              autoScroll ? "bg-brand text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            Auto-scroll
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-36">
        <div className="max-w-4xl mx-auto space-y-1">
          {segments.map((seg, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={seg.id}
                ref={isActive ? activeRef : null}
                onClick={() => {
                  if (window.getSelection()?.toString()?.trim()) return;
                  seek(seg.start_ms);
                }}
                className={`grid grid-cols-2 gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isActive ? "bg-blue-50 border-l-2 border-brand" : "hover:bg-gray-50"
                }`}
              >
                <div
                  className="text-sm leading-relaxed text-gray-900 select-text touch-manipulation"
                  data-segment-id={seg.id}
                >
                  <span className="text-[10px] text-muted tabular-nums mr-1">
                    {formatTime(seg.start_ms)}
                  </span>
                  {seg.fr_text}
                </div>
                <div className="text-sm leading-relaxed text-gray-500">
                  {seg.ru_text || (
                    <span className="text-gray-300 italic text-xs">Translation coming soon</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-20">
        <div
          className="h-1 bg-gray-100 cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seek(pct * duration);
          }}
        >
          <div
            className="h-full bg-brand transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => skip(-15)} className="text-gray-500 hover:text-gray-900 text-xs font-medium">
            -15s
          </button>
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center text-lg"
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button onClick={() => skip(15)} className="text-gray-500 hover:text-gray-900 text-xs font-medium">
            +15s
          </button>
          <span className="text-xs text-muted tabular-nums flex-1 text-right">
            {formatTime(currentMs)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {selectionBar && (
        <div data-selection-bar className="fixed inset-0 z-30 flex flex-col justify-end">
          <div className="flex-1 bg-black/20" onClick={() => { window.getSelection()?.removeAllRanges(); setSelectionBar(null); }} aria-hidden />
          <div className="bg-white border-t border-gray-200 shadow-2xl p-3 pb-6">
          <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700 flex-1 min-w-0 truncate" title={selectionBar.selectedText}>
              &ldquo;{selectionBar.selectedText}&rdquo;
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                className="min-h-[44px] min-w-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium touch-manipulation"
                onClick={() => openPanelFromSelection(selectionBar)}
              >
                Add phrase
              </button>
              <button
                type="button"
                className="min-h-[44px] min-w-[44px] px-3 rounded-lg bg-gray-100 text-gray-700 text-sm touch-manipulation"
                onClick={() => {
                  window.getSelection()?.removeAllRanges();
                  setSelectionBar(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {wordPanel && (
        <div data-word-panel className="fixed inset-0 z-30 flex flex-col justify-end">
          <div className="flex-1 bg-black/20" onClick={closeWordPanel} onTouchEnd={(e) => { e.preventDefault(); closeWordPanel(); }} aria-hidden />
          <div className="bg-white border-t border-gray-200 shadow-2xl p-4 pb-6 max-h-[85vh] overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="min-h-[44px] min-w-[44px] px-2 rounded-lg bg-gray-100 disabled:opacity-40 touch-manipulation text-sm"
                    disabled={wordPanel.startIdx <= 0}
                    onClick={() => setWordPanel((p) => (p && p.startIdx > 0 ? { ...p, startIdx: p.startIdx - 1, selectedPhrase: undefined } : p))}
                  >
                    ← Prev
                  </button>
                  <span className="text-sm font-semibold text-gray-900 py-2">&ldquo;{getSelectedText(wordPanel)}&rdquo;</span>
                  <button
                    type="button"
                    className="min-h-[44px] min-w-[44px] px-2 rounded-lg bg-gray-100 disabled:opacity-40 touch-manipulation text-sm"
                    disabled={wordPanel.endIdx >= wordPanel.wordTokens.length - 1}
                    onClick={() =>
                      setWordPanel((p) =>
                        p && p.endIdx < p.wordTokens.length - 1 ? { ...p, endIdx: p.endIdx + 1, selectedPhrase: undefined } : p
                      )
                    }
                  >
                    Next →
                  </button>
                </div>
                <button
                  type="button"
                  className="min-h-[44px] px-4 rounded-lg bg-gray-200 text-gray-800 shrink-0 touch-manipulation text-sm font-medium"
                  onClick={closeWordPanel}
                  onTouchEnd={(e) => { e.preventDefault(); closeWordPanel(); }}
                >
                  Close
                </button>
              </div>
              <div className="text-sm text-gray-700">
                {wordLoading ? "…" : (wordTranslation?.translation || "—")}
                {wordTranslation?.translation_2 && `; ${wordTranslation.translation_2}`}
                {wordTranslation?.translation_3 && `; ${wordTranslation.translation_3}`}
              </div>
              {wordTranslation?.short_note && <div className="text-xs text-gray-500">{wordTranslation.short_note}</div>}
              <div className="text-xs text-gray-500 line-clamp-2">{wordPanel.contextFr}</div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="min-h-[44px] px-4 rounded-lg bg-brand text-white disabled:opacity-50 text-sm font-medium touch-manipulation"
                  disabled={wordLoading || !wordTranslation}
                  onClick={() => saveWord()}
                  onTouchEnd={(e) => { if (!wordLoading && wordTranslation) { e.preventDefault(); saveWord(); } }}
                >
                  Save
                </button>
                {wordSaveMsg && <span className={`text-sm font-medium ${wordSaveMsg === "Saved" ? "text-green-600" : "text-gray-500"}`}>{wordSaveMsg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <audio ref={audioRef} src={episode.audio_url || ""} preload="metadata" />
    </div>
  );
}
