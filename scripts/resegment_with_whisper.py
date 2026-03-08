"""
Re-segment transcript into sentence-first chunks while preserving source text.

Key rules:
- Keep original source text exactly (1:1).
- Keep original timestamp anchors.
- Use Whisper only inside each anchor interval to distribute sub-chunk timings.
- Default split target: 1 sentence per chunk.
- If a sentence is too long, split it by clauses/words (without changing words).

Usage:
  python scripts/resegment_with_whisper.py --episode 3 --source-json scripts/data/episodes_1-10.json
  python scripts/resegment_with_whisper.py --episode 3 --source-json scripts/data/episodes_1-10.json --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

import requests
from dotenv import load_dotenv
from supabase import create_client
from faster_whisper import WhisperModel


load_dotenv(".env.local")
sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", buffering=1)

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
def execute_with_retry(builder, retries: int = 5, base_sleep: float = 1.0):
  last_err: Exception | None = None
  for attempt in range(1, retries + 1):
    try:
      return builder.execute()
    except Exception as e:
      last_err = e
      if attempt >= retries:
        raise
      sleep_s = base_sleep * attempt
      print(f"Supabase execute failed (attempt {attempt}/{retries}): {e}. retry in {sleep_s:.1f}s")
      time.sleep(sleep_s)
  if last_err:
    raise last_err
  raise RuntimeError("execute_with_retry failed without explicit error")




@dataclass
class Chunk:
  idx: int
  start_ms: int
  end_ms: int
  fr_text: str
  ru_text: str | None = None


def split_sentences_preserve(text: str) -> List[str]:
  """Split to sentence-like units, preserving original wording."""
  src = text.strip()
  if not src:
    return []

  out: List[str] = []
  last = 0
  for m in re.finditer(r"[.!?…]+(?:\s+|$)", src):
    end = m.end()
    piece = src[last:end].strip()
    if piece:
      out.append(piece)
    last = end
  tail = src[last:].strip()
  if tail:
    out.append(tail)
  return out or [src]


def split_by_words(text: str, max_chars: int) -> List[str]:
  words = re.findall(r"\S+", text.strip())
  if not words:
    return []
  out: List[str] = []
  cur = words[0]
  for w in words[1:]:
    candidate = f"{cur} {w}"
    if len(candidate) <= max_chars:
      cur = candidate
    else:
      out.append(cur)
      cur = w
  out.append(cur)
  return out


def split_long_sentence(text: str, max_chars: int) -> List[str]:
  """Split long sentence by clauses, then by words if still too long."""
  src = text.strip()
  if len(src) <= max_chars:
    return [src]

  clause_parts: List[str] = []
  last = 0
  for m in re.finditer(r"[,;:](?:\s+|$)|[—–-](?:\s+)", src):
    end = m.end()
    piece = src[last:end].strip()
    if piece:
      clause_parts.append(piece)
    last = end
  tail = src[last:].strip()
  if tail:
    clause_parts.append(tail)

  if len(clause_parts) <= 1:
    return split_by_words(src, max_chars)

  merged: List[str] = []
  cur = ""
  for part in clause_parts:
    if not cur:
      cur = part
      continue
    candidate = f"{cur} {part}".strip()
    if len(candidate) <= max_chars:
      cur = candidate
    else:
      merged.append(cur)
      cur = part
  if cur:
    merged.append(cur)

  out: List[str] = []
  for piece in merged:
    if len(piece) <= max_chars:
      out.append(piece)
    else:
      out.extend(split_by_words(piece, max_chars))
  return out


def split_units(fr_text: str, max_chars: int) -> List[str]:
  units: List[str] = []
  for sentence in split_sentences_preserve(fr_text):
    units.extend(split_long_sentence(sentence, max_chars))
  return [u for u in units if u.strip()]


def normalize_for_match(text: str) -> str:
  text = text.lower()
  text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
  text = re.sub(r"\s+", " ", text).strip()
  return text


def interpolate_time(target_chars: int, cum_chars: List[int], cum_ms: List[int]) -> int:
  if not cum_chars:
    return 0
  if target_chars <= 0:
    return 0
  if target_chars >= cum_chars[-1]:
    return cum_ms[-1]

  lo = 0
  hi = len(cum_chars) - 1
  while lo < hi:
    mid = (lo + hi) // 2
    if cum_chars[mid] < target_chars:
      lo = mid + 1
    else:
      hi = mid
  idx = lo
  if idx == 0:
    return cum_ms[0]

  c0, c1 = cum_chars[idx - 1], cum_chars[idx]
  t0, t1 = cum_ms[idx - 1], cum_ms[idx]
  if c1 == c0:
    return t1
  ratio = (target_chars - c0) / (c1 - c0)
  return int(t0 + ratio * (t1 - t0))


def transcribe_audio(audio_url: str, model_size: str = "small") -> tuple[List[int], List[int], int]:
  with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
    tmp_path = tmp.name

  try:
    with requests.get(audio_url, stream=True, timeout=60) as r:
      r.raise_for_status()
      with open(tmp_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 256):
          if chunk:
            f.write(chunk)

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(tmp_path, language="fr", vad_filter=True)

    cum_chars: List[int] = []
    cum_ms: List[int] = []
    total_chars = 0
    last_end_ms = 0
    for seg in segments:
      text = normalize_for_match(seg.text)
      total_chars += max(1, len(text))
      end_ms = int(seg.end * 1000)
      last_end_ms = max(last_end_ms, end_ms)
      cum_chars.append(total_chars)
      cum_ms.append(end_ms)

    return cum_chars, cum_ms, last_end_ms
  finally:
    try:
      os.remove(tmp_path)
    except OSError:
      pass


def interpolate_chars(target_ms: int, cum_chars: List[int], cum_ms: List[int]) -> int:
  if not cum_ms:
    return 0
  if target_ms <= 0:
    return 0
  if target_ms >= cum_ms[-1]:
    return cum_chars[-1]

  lo = 0
  hi = len(cum_ms) - 1
  while lo < hi:
    mid = (lo + hi) // 2
    if cum_ms[mid] < target_ms:
      lo = mid + 1
    else:
      hi = mid
  idx = lo
  if idx == 0:
    return cum_chars[0]

  t0, t1 = cum_ms[idx - 1], cum_ms[idx]
  c0, c1 = cum_chars[idx - 1], cum_chars[idx]
  if t1 == t0:
    return c1
  ratio = (target_ms - t0) / (t1 - t0)
  return int(c0 + ratio * (c1 - c0))


def load_source_segments(source_json: Optional[str], episode_number: int) -> Optional[List[dict]]:
  if not source_json:
    return None
  with open(source_json, "r", encoding="utf-8") as f:
    data = json.load(f)
  ep = next((x for x in data if int(x.get("number", -1)) == episode_number), None)
  if not ep:
    return None
  segs = ep.get("segments") or []
  return [
    {
      "idx": int(s["idx"]),
      "start_ms": int(s["start_ms"]),
      "end_ms": int(s.get("end_ms") or 0),
      "fr_text": str(s["fr_text"]).strip(),
      "ru_text": s.get("ru_text"),
    }
    for s in segs
  ]


def build_chunks_inside_anchors(
  source_segments: List[dict],
  cum_chars: List[int],
  cum_ms: List[int],
  episode_end_ms: int,
  max_chars: int,
) -> List[Chunk]:
  out: List[Chunk] = []
  out_idx = 0

  for i, s in enumerate(source_segments):
    start_ms = int(s.get("start_ms") or 0)
    next_start = int(source_segments[i + 1]["start_ms"]) if i + 1 < len(source_segments) else episode_end_ms
    own_end = int(s.get("end_ms") or 0)
    end_ms = own_end if own_end > start_ms else next_start
    if end_ms <= start_ms:
      end_ms = start_ms + 1200

    fr_text = str(s.get("fr_text") or "").strip()
    if not fr_text:
      continue

    units = split_units(fr_text, max_chars=max_chars)
    if len(units) <= 1:
      out.append(Chunk(idx=out_idx, start_ms=start_ms, end_ms=end_ms, fr_text=fr_text))
      out_idx += 1
      continue

    norm_parts = [normalize_for_match(x) for x in units]
    part_chars = [max(1, len(x)) for x in norm_parts]
    total_part_chars = max(1, sum(part_chars))

    # Whisper guidance only inside anchor interval
    asr_char_start = interpolate_chars(start_ms, cum_chars, cum_ms)
    asr_char_end = interpolate_chars(end_ms, cum_chars, cum_ms)
    asr_span = max(1, asr_char_end - asr_char_start)

    running_chars = 0
    sub_ranges: List[Tuple[int, int]] = []
    for j, c in enumerate(part_chars):
      rel_start = running_chars / total_part_chars
      running_chars += c
      rel_end = running_chars / total_part_chars
      target_char_start = asr_char_start + int(asr_span * rel_start)
      target_char_end = asr_char_start + int(asr_span * rel_end)
      t_start = interpolate_time(target_char_start, cum_chars, cum_ms)
      t_end = interpolate_time(target_char_end, cum_chars, cum_ms)
      sub_ranges.append((t_start, t_end))

    # Clamp and stabilize within anchor
    fixed: List[Tuple[int, int]] = []
    for j, (a, b) in enumerate(sub_ranges):
      if j == 0:
        a = start_ms
      if j == len(sub_ranges) - 1:
        b = end_ms
      a = max(start_ms, min(a, end_ms))
      b = max(start_ms, min(b, end_ms))
      if fixed:
        prev_end = fixed[-1][1]
        a = max(a, prev_end)
      if b <= a:
        b = min(end_ms, a + 800)
      if b <= a:
        b = a + 1
      fixed.append((a, b))

    # Ensure final end hits anchor end exactly
    last_a, _ = fixed[-1]
    fixed[-1] = (last_a, end_ms)

    for j, txt in enumerate(units):
      a, b = fixed[j]
      out.append(Chunk(idx=out_idx, start_ms=a, end_ms=b, fr_text=txt))
      out_idx += 1

  return out


def attach_ru_by_overlap(chunks: List[Chunk], old_segments: List[dict]) -> None:
  for c in chunks:
    ru_parts: List[str] = []
    for s in old_segments:
      s_start = int(s.get("start_ms") or 0)
      s_end = int(s.get("end_ms") or s_start)
      overlap = max(0, min(c.end_ms, s_end) - max(c.start_ms, s_start))
      if overlap <= 0:
        continue
      ru = (s.get("ru_text") or "").strip()
      if ru:
        ru_parts.append(ru)
    c.ru_text = " ".join(ru_parts).strip() or None


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--episode", type=int, required=True, help="Episode number")
  parser.add_argument("--apply", action="store_true", help="Write chunks to Supabase")
  parser.add_argument("--model", default="tiny", help="faster-whisper model size")
  parser.add_argument("--max-chars", type=int, default=180, help="Max chars per chunk for long sentences")
  parser.add_argument(
    "--source-json",
    default="scripts/data/episodes_1-10.json",
    help="JSON with original source segments (recommended).",
  )
  args = parser.parse_args()

  episode_res = execute_with_retry(
    sb.from_("episodes").select("*").eq("number", args.episode).single()
  )
  episode = episode_res.data
  if not episode:
    raise RuntimeError(f"Episode #{args.episode} not found")

  db_segs_res = execute_with_retry(
    sb.from_("segments")
    .select("id, idx, fr_text, ru_text, start_ms, end_ms")
    .eq("episode_id", episode["id"])
    .order("idx")
  )
  db_segs = db_segs_res.data or []
  if not db_segs:
    raise RuntimeError("No segments in DB")

  source_segs = load_source_segments(args.source_json, args.episode)
  if source_segs:
    base_segs = source_segs
    print(f"Using source JSON anchors/text: {args.source_json}")
  else:
    base_segs = [
      {
        "idx": int(s["idx"]),
        "start_ms": int(s["start_ms"] or 0),
        "end_ms": int(s["end_ms"] or 0),
        "fr_text": str(s["fr_text"] or "").strip(),
        "ru_text": s.get("ru_text"),
      }
      for s in db_segs
    ]
    print("Source JSON not found or missing episode. Using DB as source.")

  episode_end_ms = int((episode.get("duration_sec") or 0) * 1000)
  if episode_end_ms <= 0:
    episode_end_ms = max(int(s.get("end_ms") or 0) for s in base_segs)

  print(f"Episode #{episode['number']} {episode['title']}")
  print(f"Original anchor segments: {len(base_segs)}")
  print("Transcribing audio with Whisper...")
  cum_chars, cum_ms, asr_end_ms = transcribe_audio(episode["audio_url"], model_size=args.model)
  if asr_end_ms > episode_end_ms:
    episode_end_ms = asr_end_ms

  chunks = build_chunks_inside_anchors(base_segs, cum_chars, cum_ms, episode_end_ms, max_chars=args.max_chars)
  attach_ru_by_overlap(chunks, db_segs)
  print(f"New chunks: {len(chunks)}")

  preview = [
    {
      "idx": c.idx,
      "start_ms": c.start_ms,
      "end_ms": c.end_ms,
      "fr_text": c.fr_text,
      "ru_text": c.ru_text,
    }
    for c in chunks[:10]
  ]
  print("Preview first 10:")
  print(json.dumps(preview, ensure_ascii=False, indent=2))

  if not args.apply:
    print("\nDry run only. Add --apply to save into Supabase.")
    return

  print("\nApplying to Supabase...")
  execute_with_retry(sb.from_("segments").delete().eq("episode_id", episode["id"]))
  rows = [
    {
      "episode_id": episode["id"],
      "idx": c.idx,
      "start_ms": c.start_ms,
      "end_ms": c.end_ms,
      "fr_text": c.fr_text,
      "ru_text": c.ru_text,
    }
    for c in chunks
  ]
  execute_with_retry(sb.from_("segments").insert(rows))
  print("Done.")


if __name__ == "__main__":
  main()

