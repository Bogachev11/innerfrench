import { supabase } from "@/lib/supabase";
import type { Episode } from "@/lib/types";
import { EpisodeList } from "./EpisodeList";

export const revalidate = 60;

export default async function EpisodesPage() {
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, number, title, slug, duration_sec")
    .order("number", { ascending: true });

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-4">
        <EpisodeList episodes={(episodes as Episode[]) || []} />
      </main>
    </div>
  );
}
