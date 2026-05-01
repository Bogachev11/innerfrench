"""
Re-translate all segments of one episode (FR -> RU) using OpenAI.

Usage:
  python scripts/retranslate_episode_openai.py --episode 3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Dict

import requests
from dotenv import load_dotenv
from supabase import create_client


load_dotenv(".env.local")
sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", buffering=1)

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def chunks(lst: List[dict], size: int):
  for i in range(0, len(lst), size):
    yield lst[i:i + size]


def translate_batch(batch: List[dict], retries: int = 3) -> Dict[int, str]:
  payload = [{"idx": s["idx"], "fr_text": s["fr_text"]} for s in batch]
  prompt = (
    "Translate French transcript chunks into natural Russian.\n"
    "Return strict JSON object with key 'items', where items is array of objects:\n"
    "[{idx:number, ru_text:string}]\n"
    "Keep meaning accurate, no additions.\n"
    f"Input: {json.dumps(payload, ensure_ascii=False)}"
  )

  res = None
  for attempt in range(retries):
    try:
      res = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
          "Authorization": f"Bearer {OPENAI_API_KEY}",
          "Content-Type": "application/json",
        },
        json={
          "model": "gpt-4o-mini",
          "temperature": 0.1,
          "response_format": {"type": "json_object"},
          "messages": [
            {"role": "system", "content": "You are an accurate French to Russian translator."},
            {"role": "user", "content": prompt},
          ],
        },
        timeout=120,
      )
      res.raise_for_status()
      break
    except Exception:
      if attempt == retries - 1:
        raise
  if res is None:
    raise RuntimeError("OpenAI request failed")
  data = res.json()
  content = data["choices"][0]["message"]["content"]
  parsed = json.loads(content)
  out: Dict[int, str] = {}
  for item in parsed.get("items", []):
    out[int(item["idx"])] = str(item["ru_text"]).strip()
  return out


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--episode", type=int, required=True)
  parser.add_argument("--batch", type=int, default=12)
  parser.add_argument("--force", action="store_true", help="Retranslate all segments, even if ru_text exists")
  args = parser.parse_args()

  ep = sb.from_("episodes").select("id,number,title").eq("number", args.episode).single().execute().data
  if not ep:
    raise RuntimeError(f"Episode #{args.episode} not found")

  segs = (
    sb.from_("segments")
    .select("id,idx,fr_text,ru_text")
    .eq("episode_id", ep["id"])
    .order("idx")
    .execute()
    .data
  ) or []
  if not segs:
    raise RuntimeError("No segments found")

  print(f"Episode #{ep['number']} {ep['title']}")
  print(f"Segments: {len(segs)}")
  pending = segs if args.force else [s for s in segs if not (s.get("ru_text") or "").strip()]
  if not pending:
    print("All segments already translated.")
    return
  print(f"Pending: {len(pending)}")
  done = 0

  for batch in chunks(pending, args.batch):
    translated = translate_batch(batch)
    for s in batch:
      ru = translated.get(int(s["idx"]))
      if not ru:
        continue
      sb.from_("segments").update({"ru_text": ru}).eq("id", s["id"]).execute()
      done += 1
    print(f"  translated {done}/{len(pending)}")

  print("Done.")


if __name__ == "__main__":
  main()

