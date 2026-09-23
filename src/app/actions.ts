"use server";
// src/app/actions.ts — 이 파일의 함수들은 서버에서만 실행된다(클라이언트 번들에 코드가
// 포함되지 않는다). 뽑기의 실제 결과(draw_winner RPC 호출)도 여기서만 일어나므로,
// 브라우저에서 결과를 조작할 방법이 없다 — 클라이언트는 "뽑아줘" 요청만 보내고 서버가
// 계산한 결과를 그대로 받는다.
import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { generateSlug } from "@/lib/slug";
import { findSituation } from "@/lib/situations";
import { weightOf, type Member } from "@/lib/types";

export async function createRoom(formData: FormData) {
  const task = String(formData.get("task") ?? "").trim().slice(0, 30);
  // 문제 유형/상황 선택 단계(홈 화면 위저드)에서 넘어온 값. 아직 그 단계를 거치지 않고
  // 호출되더라도 기존처럼 동작하도록 기본값을 둔다.
  const problemType = String(formData.get("problem_type") ?? "role_assignment").trim().slice(0, 30);
  const situation = String(formData.get("situation") ?? "").trim().slice(0, 30) || null;
  const supabase = getSupabase();

  // slug 충돌은 극히 드물지만(8자, 53진법) 방어적으로 몇 번 재시도한다.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    const { error } = await supabase
      .from("rooms")
      .insert({ slug, task, problem_type: problemType, situation });
    if (!error) redirect(`/r/${slug}`);
    // unique 위반(23505)이면 다른 slug로 재시도, 그 외 에러는 바로 던진다.
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("방을 만들지 못했어요. 다시 시도해주세요.");
}

export async function addMember(roomId: string, name: string) {
  const trimmed = name.trim().slice(0, 12);
  if (!trimmed) return { ok: false as const, error: "이름을 입력해주세요" };

  const supabase = getSupabase();
  // 방금 넣은 행의 id를 돌려준다 — 이 브라우저가 방 안에서 "누구"인지 클라이언트가
  // 기억해둬야 역할 게임에서 "당신의 1지망"을 물어볼 수 있다(src/lib/identity.ts).
  const { data, error } = await supabase
    .from("members")
    .insert({ room_id: roomId, name: trimmed })
    .select()
    .single();
  if (error) return { ok: false as const, error: "이미 있는 이름이거나 저장에 실패했어요" };
  return { ok: true as const, memberId: data.id as string };
}

export async function removeMember(memberId: string) {
  const supabase = getSupabase();
  await supabase.from("members").delete().eq("id", memberId);
}

export async function updateTask(roomId: string, task: string) {
  const supabase = getSupabase();
  await supabase.from("rooms").update({ task: task.slice(0, 30) }).eq("id", roomId);
}

export async function drawWinner(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("draw_winner", { p_room_id: roomId }).maybeSingle();
  if (error) {
    if (error.message.includes("not_enough_members")) {
      return { ok: false as const, error: "참가자가 2명 이상 필요해요" };
    }
    return { ok: false as const, error: "뽑기에 실패했어요. 다시 시도해주세요" };
  }
  const winner = data as { winner_name: string };
  return { ok: true as const, winnerName: winner.winner_name };
}

// ============================================================
// 역할 게임(role_assignment): 상황을 고르면 정해지는 역할 풀 안에서
// 참가자 각자 1지망을 고르고, 겹치는 역할만 뽑기로 정한다.
// "결과가 전부 랜덤이 아니라 선택이 반영된다"는 게 기존 draw_winner와의 차이다.
// ============================================================

export async function startGame(roomId: string) {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);
  if ((count ?? 0) < 2) return { ok: false as const, error: "참가자가 2명 이상 필요해요" };

  const { error } = await supabase
    .from("rooms")
    .update({ game_phase: "preference" })
    .eq("id", roomId)
    .eq("game_phase", "lobby");
  if (error) return { ok: false as const, error: "시작하지 못했어요" };
  return { ok: true as const };
}

export async function submitPreference(roomId: string, memberId: string, roleLabel: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("role_preferences")
    .upsert(
      { room_id: roomId, member_id: memberId, role_label: roleLabel, rank: 1 },
      { onConflict: "room_id,member_id,rank" }
    );
  if (error) return { ok: false as const, error: "선택을 저장하지 못했어요" };
  return { ok: true as const };
}

// 가중치 비례 무작위 선택. draw_winner RPC와 같은 공식(weightOf)을 candidates 부분집합에
// 적용한다 — 충돌한 역할 하나를 결정할 때도 "오래 안 뽑힌 사람이 더 유리하다"는 공정성을
// 그대로 이어받는다.
function weightedPick(candidates: Member[], round: number): Member {
  const weights = candidates.map((c) => weightOf(c, round));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function resolveRoles(roomId: string) {
  const supabase = getSupabase();

  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return { ok: false as const, error: "방을 찾을 수 없어요" };
  if (room.game_phase !== "preference") {
    return { ok: false as const, error: "지금은 결과를 확정할 수 없어요" };
  }

  const situationInfo = findSituation(room.situation);
  const roleList = situationInfo?.situation.roles;
  if (!roleList) return { ok: false as const, error: "역할 정보를 찾을 수 없어요" };

  const { data: members } = await supabase.from("members").select("*").eq("room_id", roomId);
  if (!members || members.length < 2) {
    return { ok: false as const, error: "참가자가 2명 이상 필요해요" };
  }

  const { data: prefs } = await supabase
    .from("role_preferences")
    .select("*")
    .eq("room_id", roomId)
    .eq("rank", 1);

  const byRole = new Map<string, Member[]>(roleList.map((role) => [role, []]));
  for (const p of prefs ?? []) {
    const member = members.find((m) => m.id === p.member_id);
    const candidates = member && byRole.get(p.role_label);
    if (member && candidates) candidates.push(member);
  }

  const round = room.round + 1;
  const results = new Map<string, { member: Member; resolvedBy: "preference" | "draw" }>();
  const leftoverRoles: string[] = [];

  for (const [role, candidates] of byRole) {
    if (candidates.length === 0) {
      leftoverRoles.push(role);
    } else if (candidates.length === 1) {
      results.set(role, { member: candidates[0], resolvedBy: "preference" });
    } else {
      // 충돌 — 지원자들 사이에서만 가중치 뽑기로 결정한다. 진 사람은 아래에서
      // 남은 역할에 다시 배정될 기회를 갖는다.
      results.set(role, { member: weightedPick(candidates, round), resolvedBy: "draw" });
    }
  }

  const assignedMemberIds = new Set([...results.values()].map((r) => r.member.id));
  const leftoverMembers = shuffle(members.filter((m) => !assignedMemberIds.has(m.id)));
  // 지원자가 없던 역할은 아직 역할이 없는 사람들에게 무작위로 채운다(사람이 역할보다
  // 적으면 일부 역할은 이번 라운드엔 못 채운다).
  for (const role of leftoverRoles) {
    const person = leftoverMembers.shift();
    if (!person) break;
    results.set(role, { member: person, resolvedBy: "draw" });
  }

  const rows = [...results.entries()].map(([role_label, { member, resolvedBy }]) => ({
    room_id: roomId,
    role_label,
    member_id: member.id,
    member_name: member.name,
    resolved_by: resolvedBy,
    round,
  }));

  const { error: insertError } = await supabase.from("role_assignments").insert(rows);
  if (insertError) return { ok: false as const, error: "결과를 저장하지 못했어요" };

  await supabase.from("rooms").update({ round, game_phase: "result" }).eq("id", roomId);

  // 뽑기로 결정된 사람만 "이번 라운드에 뽑혔다"고 기록한다 — 자기가 고른 역할을 그대로
  // 받은 사람은 공정성 가중치에 영향을 주지 않는다(기존 draw_winner와 같은 의미).
  const drawnMemberIds = rows.filter((r) => r.resolved_by === "draw").map((r) => r.member_id);
  if (drawnMemberIds.length > 0) {
    await supabase.from("members").update({ last_picked_round: round }).in("id", drawnMemberIds);
  }

  return { ok: true as const };
}

export async function restartRound(roomId: string) {
  const supabase = getSupabase();
  await supabase.from("role_assignments").delete().eq("room_id", roomId);
  await supabase.from("role_preferences").delete().eq("room_id", roomId);
  await supabase.from("rooms").update({ game_phase: "preference" }).eq("id", roomId);
}
