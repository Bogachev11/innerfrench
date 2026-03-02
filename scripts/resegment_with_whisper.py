"""
Re-segment episode transcript into 1-3 sentence chunks using Whisper timing.

Goal:
- Keep transcript text from source pages (not ASR text).
- Re-recognize audio with Whisper to obtain better time distribution.
- Build smaller chunks (max 3 sentences each) and estimate timestamps.

Usage:
  python scripts/resegment_with_whisper.py --episode 1
  python scripts/resegment_with_whisper.py --episode 1 --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from typing import List

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


@dataclass
class Chunk:
  idx: int
  start_ms: int
  end_ms: int
  fr_text: str


def split_sentences(text: str) -> List[str]:
  parts = re.split(r"(?<=[\.\!\?\:\;])\s+", text.strip())
  return [p.strip() for p in parts if p.strip()]


def group_sentences(sentences: List[str], max_sentences: int = 3) -> List[str]:
  out: List[str] = []
  i = 0
  while i < len(sentences):
    take = min(max_sentences, len(sentences) - i)
    # Avoid very tiny last chunk (merge with previous if possible)
    if len(sentences) - (i + take) == 1 and take > 1:
      take -= 1
    out.append(" ".join(sentences[i:i + take]).strip())
    i += take
  return out


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


def build_chunks_from_transcript(full_fr_text: str, cum_chars: List[int], cum_ms: List[int], fallback_end_ms: int) -> List[Chunk]:
  sentences = split_sentences(full_fr_text)
  grouped = group_sentences(sentences, max_sentences=3)
  if not grouped:
    return []

  norm_grouped = [normalize_for_match(g) for g in grouped]
  lengths = [max(1, len(g)) for g in norm_grouped]
  total = sum(lengths)
  running = 0
  chunks: List[Chunk] = []

  for idx, grp in enumerate(grouped):
    start_chars = running
    running += lengths[idx]
    end_chars = running

    if cum_chars and cum_ms:
      start_ms = interpolate_time(start_chars, cum_chars, cum_ms)
      end_ms = interpolate_time(end_chars, cum_chars, cum_ms)
    else:
      start_ms = int((start_chars / total) * fallback_end_ms)
      end_ms = int((end_chars / total) * fallback_end_ms)

    if idx == 0:
      start_ms = 0
    if idx == len(grouped) - 1:
      end_ms = max(end_ms, fallback_end_ms)
    if end_ms <= start_ms:
      end_ms = start_ms + 1200

    chunks.append(Chunk(idx=idx, start_ms=start_ms, end_ms=end_ms, fr_text=grp))

  return chunks


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--episode", type=int, required=True, help="Episode number")
  parser.add_argument("--apply", action="store_true", help="Write chunks to Supabase")
  parser.add_argument("--model", default="tiny", help="faster-whisper model size")
  args = parser.parse_args()

  episode_res = sb.from_("episodes").select("*").eq("number", args.episode).single().execute()
  episode = episode_res.data
  if not episode:
    raise RuntimeError(f"Episode #{args.episode} not found")

  segs_res = (
    sb.from_("segments")
    .select("id, idx, fr_text, ru_text, start_ms, end_ms")
    .eq("episode_id", episode["id"])
    .order("idx")
    .execute()
  )
  segs = segs_res.data or []
  if not segs:
    raise RuntimeError("No segments in DB")

  full_fr = " ".join((s.get("fr_text") or "").strip() for s in segs if (s.get("fr_text") or "").strip())
  fallback_end_ms = int((episode.get("duration_sec") or 0) * 1000)
  if fallback_end_ms <= 0:
    fallback_end_ms = max(int(s.get("end_ms") or 0) for s in segs)

  print(f"Episode #{episode['number']} {episode['title']}")
  print(f"Original segments: {len(segs)}")
  print("Transcribing audio with Whisper...")
  cum_chars, cum_ms, asr_end_ms = transcribe_audio(episode["audio_url"], model_size=args.model)
  if asr_end_ms > 0:
    fallback_end_ms = asr_end_ms

  chunks = build_chunks_from_transcript(full_fr, cum_chars, cum_ms, fallback_end_ms)
  print(f"New chunks: {len(chunks)}")

  preview = [
    {
      "idx": c.idx,
      "start_ms": c.start_ms,
      "end_ms": c.end_ms,
      "fr_text": c.fr_text,
    }
    for c in chunks[:10]
  ]
  print("Preview first 10:")
  print(json.dumps(preview, ensure_ascii=False, indent=2))

  if not args.apply:
    print("\nDry run only. Add --apply to save into Supabase.")
    return

  print("\nApplying to Supabase...")
  sb.from_("segments").delete().eq("episode_id", episode["id"]).execute()
  rows = [
    {
      "episode_id": episode["id"],
      "idx": c.idx,
      "start_ms": c.start_ms,
      "end_ms": c.end_ms,
      "fr_text": c.fr_text,
      "ru_text": None,
    }
    for c in chunks
  ]
  sb.from_("segments").insert(rows).execute()
  print("Done.")


if __name__ == "__main__":
  main()

