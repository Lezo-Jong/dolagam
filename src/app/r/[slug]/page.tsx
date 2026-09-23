import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { findSituation } from "@/lib/situations";
import { findDecisionPreset } from "@/lib/decisionPresets";
import type {
  CustomRole,
  Draw,
  Member,
  PlayerSkill,
  Room,
  RoleAssignment,
  RoleConflict,
  RoleConflictChoice,
  RolePreference,
  RoleSwapProposal,
} from "@/lib/types";
import { RoomView } from "@/components/RoomView";
import { RoleGameView } from "@/components/RoleGameView";
import { DecisionGameView } from "@/components/DecisionGameView";

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
    const [
      { data: preferences },
      { data: assignments },
      { data: conflicts },
      { data: conflictChoices },
      { data: customRoles },
      { data: playerSkills },
      { data: swapProposals },
    ] = await Promise.all([
      supabase.from("role_preferences").select("*").eq("room_id", room.id),
      supabase.from("role_assignments").select("*").eq("room_id", room.id),
      supabase.from("role_conflicts").select("*").eq("room_id", room.id),
      supabase.from("role_conflict_choices").select("*").eq("room_id", room.id),
      supabase.from("custom_roles").select("*").eq("room_id", room.id).order("created_at", { ascending: true }),
      supabase.from("player_skills").select("*").eq("room_id", room.id),
      supabase.from("role_swap_proposals").select("*").eq("room_id", room.id),
    ]);

    return (
      <RoleGameView
        // 🔀 주제 바꾸기로 room.situation이 바뀌면 key가 달라져 컴포넌트가 완전히
        // 새로 마운트된다 — situation별로 다른 recommendedRoles/skillCategories 같은
        // "마운트 시점에만 초기화되는" 값들이 새 주제 기준으로 다시 계산되게 하기 위해서다.
        key={room.situation ?? "role"}
        initialRoom={room as Room}
        initialMembers={(members ?? []) as Member[]}
        initialPreferences={(preferences ?? []) as RolePreference[]}
        initialAssignments={(assignments ?? []) as RoleAssignment[]}
        initialConflicts={(conflicts ?? []) as RoleConflict[]}
        initialConflictChoices={(conflictChoices ?? []) as RoleConflictChoice[]}
        initialCustomRoles={(customRoles ?? []) as CustomRole[]}
        initialPlayerSkills={(playerSkills ?? []) as PlayerSkill[]}
        initialSwapProposals={(swapProposals ?? []) as RoleSwapProposal[]}
        recommendedRoles={situationInfo.situation.roles}
        skillCategories={situationInfo.situation.skills}
        situationLabel={`${situationInfo.category.label} · ${situationInfo.situation.label}`}
        recurring={situationInfo.situation.recurring}
      />
    );
  }

  // 🍚 뭘 먹을까 / 📋 뭐부터 할까 / 🕐 언제 만날까(decisionPresets.ts) — "역할 정하기"와
  // 같은 충돌 해결 엔진을 쓰지만 결과 모양이 달라서(그룹 전체가 하나의 답 / 순서) 별도
  // 화면(DecisionGameView)으로 그린다. 🛍️ 뭘 살까(budget)는 situations.ts에 이미
  // 얹어놨으니 위 situationInfo 분기에서 RoleGameView로 처리된다.
  const decisionPreset = findDecisionPreset(room.situation);
  if (decisionPreset) {
    const [
      { data: preferences },
      { data: assignments },
      { data: conflicts },
      { data: conflictChoices },
      { data: customCandidates },
    ] = await Promise.all([
      supabase.from("role_preferences").select("*").eq("room_id", room.id),
      supabase.from("role_assignments").select("*").eq("room_id", room.id),
      supabase.from("role_conflicts").select("*").eq("room_id", room.id),
      supabase.from("role_conflict_choices").select("*").eq("room_id", room.id),
      supabase.from("custom_roles").select("*").eq("room_id", room.id).order("created_at", { ascending: true }),
    ]);

    return (
      <DecisionGameView
        key={room.situation ?? "decision"}
        initialRoom={room as Room}
        initialMembers={(members ?? []) as Member[]}
        initialPreferences={(preferences ?? []) as RolePreference[]}
        initialAssignments={(assignments ?? []) as RoleAssignment[]}
        initialConflicts={(conflicts ?? []) as RoleConflict[]}
        initialConflictChoices={(conflictChoices ?? []) as RoleConflictChoice[]}
        initialCustomCandidates={(customCandidates ?? []) as CustomRole[]}
        defaultCandidates={decisionPreset.candidates}
        mode={decisionPreset.mode}
        label={decisionPreset.label}
        resultTitle={decisionPreset.resultTitle}
        situationLabel={decisionPreset.label}
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
