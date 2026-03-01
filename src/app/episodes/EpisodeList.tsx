"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Episode } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return `${m} min`;
}

export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const deviceId = getDeviceId();
    supabase
      .from("episode_progress")
      .select("episode_id")
      .eq("device_id", deviceId)
      .eq("completed", true)
      .then(({ data }) => {
        if (data) setCompleted(new Set(data.map((d) => d.episode_id)));
      });
  }, []);

  return (
    <div className="space-y-1">
      {episodes.map((ep) => {
        const done = completed.has(ep.id);
        return (
          <Link
            key={ep.id}
            href={`/episodes/${ep.slug}`}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
              done
                ? "text-gray-400"
                : "text-gray-900 hover:bg-gray-50 active:bg-gray-100"
            }`}
          >
            <span
              className={`text-xs font-semibold w-8 text-right tabular-nums ${
                done ? "text-gray-300" : "text-muted"
              }`}
            >
              {ep.number}
            </span>
            <span className={`flex-1 text-sm leading-snug ${done ? "line-through decoration-gray-300" : ""}`}>
              {ep.title}
            </span>
            {ep.duration_sec && (
              <span className="text-xs text-muted whitespace-nowrap">
                {formatDuration(ep.duration_sec)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
