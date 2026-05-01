/**
 * Debug: why day 5 or 6 have no data on Word Count.
 * Reuses same dayKey + firstDayByEpisode logic as word-count page.
 * Run: npx tsx scripts/debugWordCountDays.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const TZ = "Europe/Paris";
const START_KEY = "2026-03-01";

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
  let y = get("year");
  let m = get("month");
  let day = get("day");
  const h = get("hour");
  if (h < 2) {
    const prev = new Date(Date.UTC(y, m - 1, day) - 86400000);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    day = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: allSessions } = await supabase
    .from("listening_sessions")
    .select("device_id, episode_id, started_at, listened_ms");
  const sessions = allSessions || [];

  const deviceTotals = new Map<string, number>();
  for (const s of sessions) {
    const key = String(s.device_id);
    deviceTotals.set(key, (deviceTotals.get(key) || 0) + (s.listened_ms || 0));
  }
  const deviceId = [...deviceTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const deviceSessions = sessions.filter((s) => String(s.device_id) === deviceId);

  console.log("Device (most listened):", deviceId);
  console.log("Sessions for this device:", deviceSessions.length);
  console.log("");

  const firstDayByEpisode = new Map<string, string>();
  const sessionDetails: Array<{ started_at: string; day: string; episode_id: string }> = [];
  for (const s of deviceSessions) {
    const ep = String(s.episode_id);
    const day = dayKey(s.started_at as string);
    sessionDetails.push({ started_at: s.started_at as string, day, episode_id: ep });
    const prev = firstDayByEpisode.get(ep);
    if (!prev || day < prev) firstDayByEpisode.set(ep, day);
  }

  const episodesByDay = new Map<string, string[]>();
  for (const [ep, day] of firstDayByEpisode.entries()) {
    if (!episodesByDay.has(day)) episodesByDay.set(day, []);
    episodesByDay.get(day)!.push(ep);
  }

  const daysWithData = [...episodesByDay.keys()].sort();
  console.log("Days that have at least one episode (first listen):", daysWithData.join(", "));
  console.log("");

  let cursor = START_KEY;
  const lastDay = daysWithData.length ? daysWithData[daysWithData.length - 1] : START_KEY;
  let dayIndex = 0;
  const dayList: Array<{ dayIndex: number; day: string; episodeIds: string[] }> = [];
  while (cursor <= lastDay) {
    dayIndex += 1;
    const eps = episodesByDay.get(cursor) || [];
    dayList.push({ dayIndex, day: cursor, episodeIds: eps });
    cursor = addDay(cursor);
  }

  console.log("Day index -> day key -> episode count (same as Word Count):");
  for (const row of dayList) {
    const mark = row.episodeIds.length === 0 ? "  <-- NO DATA" : "";
    console.log(`  day ${row.dayIndex}  ${row.day}  episodes: ${row.episodeIds.length}${mark}`);
  }
  console.log("");

  console.log("Raw sessions (started_at -> dayKey):");
  sessionDetails.sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const s of sessionDetails) {
    console.log(`  ${s.started_at}  ->  ${s.day}  (episode ${s.episode_id.slice(0, 8)}...)`);
  }
}

main().catch(console.error);
