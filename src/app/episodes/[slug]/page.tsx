import { supabase } from "@/lib/supabase";
import type { Episode, Segment } from "@/lib/types";
import { notFound } from "next/navigation";
import { EpisodePlayer } from "./EpisodePlayer";
import { RequireAuth } from "@/lib/RequireAuth";

export const revalidate = 3600;

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: episode } = await supabase
    .from("episodes")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!episode) notFound();

  const { data: segments } = await supabase
    .from("segments")
    .select("*")
    .eq("episode_id", episode.id)
    .order("idx", { ascending: true });

  return (
    <RequireAuth>
      <EpisodePlayer
        episode={episode as Episode}
        segments={(segments as Segment[]) || []}
      />
    </RequireAuth>
  );
}
