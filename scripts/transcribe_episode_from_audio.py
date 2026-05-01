"""
Create segments from audio only (no existing transcript).
Uses Whisper, then merges into sentence-sized chunks.
Usage: python scripts/transcribe_episode_from_audio.py --episode 21 --apply
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from typing import List, Tuple

import requests
from dotenv import load_dotenv
from supabase import create_client
from faster_whisper import WhisperModel

load_dotenv(".env.local")
sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

MAX_CHARS = 200  # small chunks


def transcribe_to_segments(audio_url: str, model_size: str = "small") -> List[Tuple[int, int, str]]:
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        with requests.get(audio_url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=256 * 1024):
                    if chunk:
                        f.write(chunk)
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(tmp_path, language="fr", vad_filter=True)
        out = []
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            start_ms = int(seg.start * 1000)
            end_ms = int(seg.end * 1000)
            out.append((start_ms, end_ms, text))
        return out
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def merge_into_chunks(segments: List[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    """Merge short Whisper segments into ~sentence-sized chunks (max MAX_CHARS)."""
    if not segments:
        return []
    chunks = []
    acc_start, acc_end, acc_text = segments[0][0], segments[0][1], segments[0][2]
    for i in range(1, len(segments)):
        s_start, s_end, s_text = segments[i]
        candidate = f"{acc_text} {s_text}".strip() if acc_text else s_text
        if len(candidate) <= MAX_CHARS and acc_end and s_start - acc_end < 4000:
            acc_end = s_end
            acc_text = candidate
        else:
            if acc_text:
                chunks.append((acc_start, acc_end, acc_text))
            acc_start, acc_end, acc_text = s_start, s_end, s_text
    if acc_text:
        chunks.append((acc_start, acc_end, acc_text))
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    ep_res = sb.from_("episodes").select("*").eq("number", args.episode).single().execute()
    ep = ep_res.data
    if not ep:
        print(f"Episode #{args.episode} not found")
        sys.exit(1)

    audio_url = (ep.get("audio_url") or "").strip()
    if not audio_url:
        print("Episode has no audio_url")
        sys.exit(1)

    print(f"Episode #{ep['number']} {ep.get('title', '')}")
    print("Transcribing with Whisper...")
    raw = transcribe_to_segments(audio_url, model_size=args.model)
    print(f"  Raw segments: {len(raw)}")
    chunks = merge_into_chunks(raw)
    print(f"  Merged chunks: {len(chunks)}")

    rows = [
        {"episode_id": ep["id"], "idx": i, "start_ms": start, "end_ms": end, "fr_text": text}
        for i, (start, end, text) in enumerate(chunks)
    ]
    if not args.apply:
        print("Preview first 3:", rows[:3])
        print("Add --apply to insert into Supabase.")
        return

    sb.from_("segments").delete().eq("episode_id", ep["id"]).execute()
    sb.from_("segments").insert(rows).execute()
    print("Segments inserted. Run: npx tsx scripts/autoTranslate.ts")


if __name__ == "__main__":
    main()
