"""
Neural FR->RU translation of all untranslated segments using argostranslate.
"""
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

from dotenv import load_dotenv
load_dotenv(".env.local")

from supabase import create_client

url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
sb = create_client(url, key)

import argostranslate.package
import argostranslate.translate

def setup_model():
    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    pkg = next((p for p in available if p.from_code == "fr" and p.to_code == "ru"), None)
    if pkg:
        installed = [f"{ip.from_code}-{ip.to_code}" for ip in argostranslate.package.get_installed_packages()]
        if "fr-ru" not in installed:
            print("Downloading fr->ru model...")
            argostranslate.package.install_from_path(pkg.download())
    else:
        print("No direct fr->ru. Installing fr->en + en->ru...")
        for src, tgt in [("fr", "en"), ("en", "ru")]:
            installed = [f"{ip.from_code}-{ip.to_code}" for ip in argostranslate.package.get_installed_packages()]
            if f"{src}-{tgt}" not in installed:
                p = next((p for p in available if p.from_code == src and p.to_code == tgt), None)
                if p:
                    print(f"  Installing {src}->{tgt}...")
                    argostranslate.package.install_from_path(p.download())
    print("Model ready")

def translate(text):
    return argostranslate.translate.translate(text, "fr", "ru")

def main():
    setup_model()

    # Fetch ALL untranslated segments (paginated, Supabase default limit is 1000)
    all_segments = []
    offset = 0
    while True:
        result = sb.table("segments")\
            .select("id, fr_text, episode_id, idx")\
            .is_("ru_text", "null")\
            .order("episode_id")\
            .order("idx")\
            .range(offset, offset + 999)\
            .execute()
        batch = result.data
        if not batch:
            break
        all_segments.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if not all_segments:
        print("All segments already translated!")
        return

    print(f"\n{len(all_segments)} segments to translate\n")

    current_ep = None
    done = 0

    for seg in all_segments:
        if seg["episode_id"] != current_ep:
            current_ep = seg["episode_id"]
            ep = sb.table("episodes").select("number, title").eq("id", current_ep).single().execute()
            print(f"\n  Episode #{ep.data['number']} {ep.data['title']}")

        try:
            ru = translate(seg["fr_text"])
            sb.table("segments").update({"ru_text": ru}).eq("id", seg["id"]).execute()
            done += 1
            sys.stdout.write(".")
            sys.stdout.flush()
        except Exception as e:
            print(f"\n  ERR ({seg['id']}): {e}")

    print(f"\n\nDone: {done}/{len(all_segments)} translated")

if __name__ == "__main__":
    main()
