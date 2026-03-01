import os, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from dotenv import load_dotenv
load_dotenv(".env.local")
from supabase import create_client

sb = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

r1 = sb.table("segments").select("id", count="exact").execute()
print(f"Total segments: {r1.count}")

r2 = sb.table("segments").select("id", count="exact").is_("ru_text", "null").execute()
print(f"NULL ru_text: {r2.count}")

r3 = sb.table("segments").select("id, ru_text, fr_text").not_.is_("ru_text", "null").limit(3).execute()
for s in r3.data:
    ru = s["ru_text"][:80] if s["ru_text"] else "NONE"
    fr = s["fr_text"][:80]
    print(f"  ru: {ru}")
    print(f"  fr: {fr}")
    print()
