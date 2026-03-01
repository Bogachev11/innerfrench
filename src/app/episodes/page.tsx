import { supabase } from "@/lib/supabase";
import type { Episode } from "@/lib/types";
import { EpisodeList } from "./EpisodeList";

export const revalidate = 3600;

export default async function EpisodesPage() {
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, number, title, slug, duration_sec")
    .order("number", { ascending: true });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold">InnerFrench</h1>
          <a href="/dashboard" className="text-sm text-brand font-medium">
            Dashboard →
          </a>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-4">
        <EpisodeList episodes={(episodes as Episode[]) || []} />
      </main>
    </div>
  );
}
