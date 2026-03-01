"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { Episode, Segment } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

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
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-2">
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
                onClick={() => seek(seg.start_ms)}
                className={`grid grid-cols-2 gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isActive ? "bg-blue-50 border-l-2 border-brand" : "hover:bg-gray-50"
                }`}
              >
                <div className="text-sm leading-relaxed text-gray-900">
                  <span className="text-[10px] text-muted tabular-nums mr-1">
                    {formatTime(seg.start_ms)}
                  </span>
                  {seg.fr_text}
                </div>
                <div className="text-sm leading-relaxed text-gray-500">
                  {seg.ru_text || (
                    <span className="text-gray-300 italic text-xs">Перевод скоро будет</span>
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

      <audio ref={audioRef} src={episode.audio_url || ""} preload="metadata" />
    </div>
  );
}
