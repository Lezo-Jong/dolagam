import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { findSituation } from "@/lib/situations";
import type { Draw, Member, Room, RoleAssignment, RolePreference } from "@/lib/types";
import { RoomView } from "@/components/RoomView";
import { RoleGameView } from "@/components/RoleGameView";

export default async function RoomPage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const supabase = getSupabase();

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) notFound();

  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });

  // situation이 situations.ts 프리셋과 매칭되면 새 역할 게임 화면을 보여준다. 매칭되지
  // 않으면(예전에 만들어진, 자유 텍스트 task 한 줄짜리 방) 기존 RoomView를 그대로 쓴다 —
  // 하위 호환을 위해 예전 방식을 버리지 않는다.
  const situationInfo = findSituation(room.situation);

  if (situationInfo) {
    const [{ data: preferences }, { data: assignments }] = await Promise.all([
      supabase.from("role_preferences").select("*").eq("room_id", room.id),
      supabase.from("role_assignments").select("*").eq("room_id", room.id),
    ]);

    return (
      <RoleGameView
        initialRoom={room as Room}
        initialMembers={(members ?? []) as Member[]}
        initialPreferences={(preferences ?? []) as RolePreference[]}
        initialAssignments={(assignments ?? []) as RoleAssignment[]}
        roles={situationInfo.situation.roles}
        situationLabel={`${situationInfo.category.label} · ${situationInfo.situation.label}`}
      />
    );
  }

  const { data: draws } = await supabase
    .from("draws")
    .select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <RoomView
      initialRoom={room as Room}
      initialMembers={(members ?? []) as Member[]}
      initialDraws={(draws ?? []) as Draw[]}
    />
  );
}
