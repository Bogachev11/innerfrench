import { supabase } from "@/lib/supabase";
import type { Episode } from "@/lib/types";
import { EpisodeList } from "./EpisodeList";
import { RequireAuth } from "@/lib/RequireAuth";

export const revalidate = 60;

export default async function EpisodesPage() {
  let episodes: Episode[] | null = null;
  try {
    const { data } = await supabase
      .from("episodes")
      .select("id, number, title, slug, duration_sec")
      .order("number", { ascending: true });
    episodes = data as Episode[] | null;
  } catch {
    episodes = [];
  }

  return (
    <RequireAuth>
      <div className="min-h-screen">
        <main className="max-w-2xl mx-auto px-4 py-4">
          <EpisodeList episodes={episodes ?? []} />
        </main>
      </div>
    </RequireAuth>
  );
}
