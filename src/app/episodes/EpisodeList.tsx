"use client";

import { useEffect, useState } from "react";
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

function formatMin(sec: number) {
  return `${Math.floor(sec / 60)} мин`;
}

export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());

  useEffect(() => {
    const deviceId = getDeviceId();
    supabase
      .from("episode_progress")
      .select("episode_id, last_position_ms, total_listened_ms, completed")
      .eq("device_id", deviceId)
      .then(({ data }) => {
        if (data) {
          setProgress(new Map(data.map((d) => [d.episode_id, d as Progress])));
        }
      });
  }, []);

  return (
    <div className="space-y-1.5">
      {episodes.map((ep) => {
        const p = progress.get(ep.id);
        const done = p?.completed ?? false;
        const durMs = (ep.duration_sec ?? 0) * 1000;
        const pct = durMs > 0 && p ? Math.min((p.last_position_ms / durMs) * 100, 100) : 0;

        return (
          <Link
            key={ep.id}
            href={`/episodes/${ep.slug}`}
            className="block relative rounded-lg overflow-hidden transition-colors active:opacity-80"
          >
            {/* Progress bar background */}
            <div
              className={`absolute inset-0 transition-all ${done ? "bg-emerald-100" : "bg-amber-50"}`}
              style={{ width: done ? "100%" : `${pct}%` }}
            />
            <div className="absolute inset-0 bg-white/40" style={{ left: done ? "100%" : `${pct}%` }} />

            <div className="relative flex items-center gap-3 px-3 py-2.5">
              <span className={`text-xs font-semibold w-7 text-right tabular-nums ${done ? "text-emerald-600" : "text-gray-400"}`}>
                {done ? "✓" : ep.number}
              </span>
              <span className={`flex-1 text-sm leading-snug ${done ? "text-emerald-800" : "text-gray-900"}`}>
                {ep.title}
              </span>
              {ep.duration_sec != null && ep.duration_sec > 0 && (
                <span className={`text-xs whitespace-nowrap tabular-nums ${done ? "text-emerald-500" : "text-gray-400"}`}>
                  {formatMin(ep.duration_sec)}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
