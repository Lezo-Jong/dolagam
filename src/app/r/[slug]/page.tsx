import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { Draw, Member, Room } from "@/lib/types";
import { RoomView } from "@/components/RoomView";

export default async function RoomPage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const supabase = getSupabase();

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) notFound();

  const [{ data: members }, { data: draws }] = await Promise.all([
    supabase
      .from("members")
      .select("*")
      .eq("room_id", room.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("draws")
      .select("*")
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <RoomView
      initialRoom={room as Room}
      initialMembers={(members ?? []) as Member[]}
      initialDraws={(draws ?? []) as Draw[]}
    />
  );
}
