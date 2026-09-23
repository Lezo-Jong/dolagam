"use server";
// src/app/actions.ts — 이 파일의 함수들은 서버에서만 실행된다(클라이언트 번들에 코드가
// 포함되지 않는다). 뽑기의 실제 결과(draw_winner RPC 호출)도 여기서만 일어나므로,
// 브라우저에서 결과를 조작할 방법이 없다 — 클라이언트는 "뽑아줘" 요청만 보내고 서버가
// 계산한 결과를 그대로 받는다.
import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { generateSlug } from "@/lib/slug";
import { findSituation, type Situation } from "@/lib/situations";
import { getDecisionMode, type DecisionMode } from "@/lib/decisionPresets";
import { weightOf, type ConflictChoice, type Member, type RpsMove, type SkillSnapshot } from "@/lib/types";

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

// activeRoles: 이번 게임에서 실제로 쓸 역할 이름들(추천 + 커스텀 중 체크된 것). 이
// 스냅샷을 rooms.active_roles에 저장해두면, 나중에 커스텀 역할이 수정/삭제돼도 이미
// 시작한 게임의 역할 풀은 안 바뀐다.
export async function startGame(roomId: string, activeRoles: string[]) {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);
  if ((count ?? 0) < 2) return { ok: false as const, error: "참가자가 2명 이상 필요해요" };
  if (activeRoles.length < (count ?? 0)) {
    return { ok: false as const, error: "참가자 수보다 역할이 적어요" };
  }

  const { error } = await supabase
    .from("rooms")
    .update({ game_phase: "preference", conflict_rank: 0, active_roles: activeRoles })
    .eq("id", roomId)
    .eq("game_phase", "lobby");
  if (error) return { ok: false as const, error: "시작하지 못했어요" };
  return { ok: true as const };
}

// ============================================================
// 커스텀 역할("내 역할") — situations.ts의 고정 역할은 "추천 역할"로 남고, 이건 방마다
// 자유롭게 추가하는 역할이다. RLS는 완전히 열려 있어서 "만든 사람만 수정/삭제" 권한은
// 여기(서버 액션)에서 created_by를 대조해 지킨다.
// ============================================================

// skillCategory: 이 역할과 연결할 능력(situations.ts situation.skills 중 하나). 필수
// 아님 — null이면 이 역할엔 능력/선호 표시가 안 붙는다(스펙 11번).
export async function addCustomRole(
  roomId: string,
  memberId: string,
  name: string,
  description: string,
  skillCategory: string | null
) {
  const trimmedName = name.trim().slice(0, 20);
  if (!trimmedName) return { ok: false as const, error: "역할 이름을 입력해주세요" };

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("custom_roles")
    .insert({
      room_id: roomId,
      name: trimmedName,
      description: description.trim().slice(0, 60) || null,
      created_by: memberId,
      skill_category: skillCategory,
    })
    .select()
    .single();
  if (error) return { ok: false as const, error: "역할을 추가하지 못했어요" };
  return { ok: true as const, roleId: data.id as string };
}

export async function updateCustomRole(
  roleId: string,
  memberId: string,
  name: string,
  description: string,
  skillCategory: string | null
) {
  const trimmedName = name.trim().slice(0, 20);
  if (!trimmedName) return { ok: false as const, error: "역할 이름을 입력해주세요" };

  const supabase = getSupabase();
  const { data: role } = await supabase.from("custom_roles").select("created_by").eq("id", roleId).maybeSingle();
  if (!role || role.created_by !== memberId) {
    return { ok: false as const, error: "이 역할을 수정할 권한이 없어요" };
  }

  const { error } = await supabase
    .from("custom_roles")
    .update({
      name: trimmedName,
      description: description.trim().slice(0, 60) || null,
      skill_category: skillCategory,
      updated_at: new Date().toISOString(),
    })
    .eq("id", roleId);
  if (error) return { ok: false as const, error: "역할을 수정하지 못했어요" };
  return { ok: true as const };
}

export async function deleteCustomRole(roleId: string, memberId: string) {
  const supabase = getSupabase();
  const { data: role } = await supabase.from("custom_roles").select("created_by").eq("id", roleId).maybeSingle();
  if (!role || role.created_by !== memberId) {
    return { ok: false as const, error: "이 역할을 삭제할 권한이 없어요" };
  }

  await supabase.from("custom_roles").delete().eq("id", roleId);
  return { ok: true as const };
}

// ============================================================
// 플레이어 능력/선호 — "지금의 프로필"이라 게임 도중에도 자유롭게 고칠 수 있다. 이
// 값은 결과를 자동으로 정하지 않고, 충돌 카드/결과 화면에 참고 정보로만 쓰인다(스펙
// 6번). level은 0(미설정)~3.
// ============================================================

export async function setSkillLevel(roomId: string, memberId: string, skillCategory: string, level: number) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("player_skills")
    .upsert(
      { room_id: roomId, member_id: memberId, skill_category: skillCategory, skill_level: level },
      { onConflict: "room_id,member_id,skill_category" }
    );
  if (error) return { ok: false as const, error: "능력을 저장하지 못했어요" };
  return { ok: true as const };
}

export async function setPreferenceLevel(
  roomId: string,
  memberId: string,
  skillCategory: string,
  level: number
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("player_skills")
    .upsert(
      { room_id: roomId, member_id: memberId, skill_category: skillCategory, preference_level: level },
      { onConflict: "room_id,member_id,skill_category" }
    );
  if (error) return { ok: false as const, error: "선호를 저장하지 못했어요" };
  return { ok: true as const };
}

// 역할 이름 -> 관련 능력 카테고리. 추천 역할은 situations.ts에, 커스텀 역할은
// custom_roles.skill_category에 있다. 연결된 능력이 없으면 null(그 역할은 능력/선호를
// 표시하지 않는다).
async function getRoleSkillCategory(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  situation: Situation,
  roleLabel: string
): Promise<string | null> {
  const fromSituation = situation.roleSkills[roleLabel];
  if (fromSituation) return fromSituation;

  const { data } = await supabase
    .from("custom_roles")
    .select("skill_category")
    .eq("room_id", roomId)
    .eq("name", roleLabel)
    .maybeSingle();
  return data?.skill_category ?? null;
}

async function getSkillSnapshot(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  memberId: string,
  skillCategory: string | null
): Promise<SkillSnapshot | null> {
  if (!skillCategory) return null;
  const { data } = await supabase
    .from("player_skills")
    .select("skill_level, preference_level")
    .eq("room_id", roomId)
    .eq("member_id", memberId)
    .eq("skill_category", skillCategory)
    .maybeSingle();
  return { skill_level: data?.skill_level ?? 0, preference_level: data?.preference_level ?? 0 };
}

// rank: 1~3지망. roleLabel이 null/빈 문자열이면 그 지망 선택을 지운다(반드시 3개를
// 다 채울 필요는 없다).
export async function submitPreference(
  roomId: string,
  memberId: string,
  rank: number,
  roleLabel: string | null
) {
  const supabase = getSupabase();

  if (!roleLabel) {
    const { error } = await supabase
      .from("role_preferences")
      .delete()
      .eq("room_id", roomId)
      .eq("member_id", memberId)
      .eq("rank", rank);
    if (error) return { ok: false as const, error: "선택을 지우지 못했어요" };
    return { ok: true as const };
  }

  // 같은 역할을 다른 지망에 이미 골라뒀다면(예: 2지망이었던 역할을 1지망으로 옮기는
  // 경우) 그 지망을 먼저 비워야 "역할 중복 선택 불가" 유니크 제약에 걸리지 않는다.
  await supabase
    .from("role_preferences")
    .delete()
    .eq("room_id", roomId)
    .eq("member_id", memberId)
    .eq("role_label", roleLabel)
    .neq("rank", rank);

  const { error } = await supabase
    .from("role_preferences")
    .upsert(
      { room_id: roomId, member_id: memberId, role_label: roleLabel, rank },
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

// 무작위로 섞어서 짝짓되, 직전 라운드에 그 역할을 맡았던 사람과 겹치면 겹치지 않는
// 다른 자리와 맞바꿔본다. 완벽한 알고리즘은 아니고(맞바꿀 상대가 없으면 그냥 둔다),
// "직전에 하던 걸 그대로 또 하는 것"만 최대한 피하는 수준이다.
function assignLeftoversAvoidingRepeat(
  members: Member[],
  roles: string[],
  previousRoleByMember: Map<string, string>
): { member: Member; role: string }[] {
  const shuffledMembers = shuffle(members);
  const count = Math.min(shuffledMembers.length, roles.length);
  const pairs = shuffledMembers.slice(0, count).map((member, i) => ({ member, role: roles[i] }));

  for (let i = 0; i < pairs.length; i++) {
    if (previousRoleByMember.get(pairs[i].member.id) !== pairs[i].role) continue;
    const swapWith = pairs.findIndex(
      (p, j) =>
        j !== i &&
        previousRoleByMember.get(p.member.id) !== pairs[i].role &&
        previousRoleByMember.get(pairs[i].member.id) !== p.role
    );
    if (swapWith !== -1) {
      const tmp = pairs[i].role;
      pairs[i].role = pairs[swapWith].role;
      pairs[swapWith].role = tmp;
    }
  }
  return pairs;
}

// 지망 순서대로(1지망 -> 2지망 -> 3지망) 라운드를 돌면서 배정한다. 각 지망 단계에서
// 역할 하나에 후보가 1명뿐이면 바로 배정하고, 2명 이상 몰리면(충돌) 즉시 뽑지 않고
// role_conflicts 행을 만들어 "우선권/양보/승부" 선택을 기다린다 — 뽑기는 게임 전체가
// 아니라 그 선택이 끝난 뒤(둘 다 우선권을 쓰거나 승부를 택했을 때의 가위바위보, 혹은
// 3명 이상 동률일 때)에만 등장하는 충돌 해결 수단 중 하나가 된다.
// 충돌에서 진 사람은 다음 지망 단계에서 자기 다음 지망으로 다시 시도한다. 지망을 다
// 써도 못 받았거나 아무도 원하지 않은 역할은 마지막에 무작위로 짝지어진다
// (resolved_by='draw', assigned_rank=null = "비선호 역할 배정").
// 서로 다른 두 충돌이 거의 동시에 끝나면 두 요청이 동시에 "다음 지망으로 넘어가자"고
// 판단해서 같은 배정을 두 번 만들어버릴 수 있다(실제로 테스트 중 발견됨). rooms.advancing을
// 락으로 써서 한 번에 한 요청만 진행하게 막는다 — 클레임에 실패한 쪽은 이미 다른 요청이
// 같은 작업을 마쳤다는 뜻이라 조용히 넘어가면 된다.
async function claimAdvance(supabase: ReturnType<typeof getSupabase>, roomId: string): Promise<boolean> {
  const { data } = await supabase
    .from("rooms")
    .update({ advancing: true })
    .eq("id", roomId)
    .eq("advancing", false)
    .select("id");
  return (data?.length ?? 0) > 0;
}

async function processNextRank(supabase: ReturnType<typeof getSupabase>, roomId: string): Promise<void> {
  const claimed = await claimAdvance(supabase, roomId);
  if (!claimed) return; // 다른 요청이 이미 다음 단계로 넘어가는 중
  try {
    await processNextRankInner(supabase, roomId);
  } finally {
    await supabase.from("rooms").update({ advancing: false }).eq("id", roomId);
  }
}

async function processNextRankInner(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string
): Promise<void> {
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room || (room.game_phase !== "preference" && room.game_phase !== "conflict")) return;

  const situationInfo = findSituation(room.situation);
  if (!situationInfo) return;
  // "게임 시작" 때 고른 역할 스냅샷을 우선 쓰고, 한 번도 안 골라본(예전) 방이면 추천
  // 역할 전체로 대체한다 — 이 기능이 생기기 전에 만들어진 방도 그대로 동작해야 한다.
  const roleList: string[] =
    room.active_roles && room.active_roles.length > 0 ? room.active_roles : situationInfo.situation.roles;

  const { data: members } = await supabase.from("members").select("*").eq("room_id", roomId);
  if (!members) return;

  const workingRound = room.round + 1;
  const { data: existing } = await supabase
    .from("role_assignments")
    .select("*")
    .eq("room_id", roomId)
    .eq("round", workingRound);

  const assignedMemberIds = new Set((existing ?? []).map((a) => a.member_id));
  const claimedRoles = new Set((existing ?? []).map((a) => a.role_label));
  const unassigned = members.filter((m) => !assignedMemberIds.has(m.id));
  const remainingRoles = roleList.filter((r) => !claimedRoles.has(r));

  const maxRank = Math.min(3, roleList.length);
  const nextRank = room.conflict_rank + 1;

  if (unassigned.length === 0 || remainingRoles.length === 0 || nextRank > maxRank) {
    // 지망을 다 써도 못 받았거나 아무도 원하지 않은 역할 <-> 사람을 무작위로 짝짓고 마무리한다.
    // 완벽한 공정성 알고리즘까진 아니지만, 가능하면 직전 라운드에 맡았던 역할을 그대로
    // 다시 받는 것 정도는 피한다(반복 당번에서 특히 중요한 부분).
    let previousRoleByMember = new Map<string, string>();
    if (room.round > 0) {
      const { data: prevAssignments } = await supabase
        .from("role_assignments")
        .select("member_id, role_label")
        .eq("room_id", roomId)
        .eq("round", room.round);
      previousRoleByMember = new Map(
        (prevAssignments ?? [])
          .filter((a): a is { member_id: string; role_label: string } => a.member_id !== null)
          .map((a) => [a.member_id, a.role_label])
      );
    }

    const pairs = assignLeftoversAvoidingRepeat(unassigned, remainingRoles, previousRoleByMember);
    const rows = [];
    for (const { member, role } of pairs) {
      const skillCategory = await getRoleSkillCategory(supabase, roomId, situationInfo.situation, role);
      const snapshot = await getSkillSnapshot(supabase, roomId, member.id, skillCategory);
      rows.push({
        room_id: roomId,
        role_label: role,
        member_id: member.id,
        member_name: member.name,
        assigned_rank: null,
        resolved_by: "draw" as const,
        round: workingRound,
        skill_level: snapshot?.skill_level ?? null,
        preference_level: snapshot?.preference_level ?? null,
      });
    }
    if (rows.length > 0) await supabase.from("role_assignments").insert(rows);

    const drawnIds = rows.map((r) => r.member_id);
    if (drawnIds.length > 0) {
      await supabase.from("members").update({ last_picked_round: workingRound }).in("id", drawnIds);
    }

    await supabase
      .from("rooms")
      .update({ round: workingRound, game_phase: "result", conflict_rank: 0 })
      .eq("id", roomId);
    return;
  }

  const { data: prefs } = await supabase
    .from("role_preferences")
    .select("*")
    .eq("room_id", roomId)
    .eq("rank", nextRank);

  const byRole = new Map<string, Member[]>();
  for (const p of prefs ?? []) {
    if (!remainingRoles.includes(p.role_label)) continue;
    const member = unassigned.find((m) => m.id === p.member_id);
    if (!member) continue;
    if (!byRole.has(p.role_label)) byRole.set(p.role_label, []);
    byRole.get(p.role_label)!.push(member);
  }

  const singleRows: {
    room_id: string;
    role_label: string;
    member_id: string;
    member_name: string;
    assigned_rank: number;
    resolved_by: "preference";
    round: number;
    skill_level: number | null;
    preference_level: number | null;
  }[] = [];
  const conflictsToCreate: {
    room_id: string;
    round: number;
    rank: number;
    role_label: string;
    candidate_ids: string[];
    status: "choosing";
    candidate_skills: Record<string, SkillSnapshot> | null;
  }[] = [];

  for (const [role, candidates] of byRole) {
    const skillCategory = await getRoleSkillCategory(supabase, roomId, situationInfo.situation, role);

    if (candidates.length === 1) {
      const snapshot = await getSkillSnapshot(supabase, roomId, candidates[0].id, skillCategory);
      singleRows.push({
        room_id: roomId,
        role_label: role,
        member_id: candidates[0].id,
        member_name: candidates[0].name,
        assigned_rank: nextRank,
        resolved_by: "preference",
        round: workingRound,
        skill_level: snapshot?.skill_level ?? null,
        preference_level: snapshot?.preference_level ?? null,
      });
    } else {
      // 충돌 카드에 "철수 능력⭐⭐⭐/선호❤️❤️" 식으로 보여줄 후보별 스냅샷 — 판정이
      // 끝날 때까지(그리고 기록에서도) 이 값 그대로 쓴다.
      let candidateSkills: Record<string, SkillSnapshot> | null = null;
      if (skillCategory) {
        candidateSkills = {};
        for (const candidate of candidates) {
          const snapshot = await getSkillSnapshot(supabase, roomId, candidate.id, skillCategory);
          if (snapshot) candidateSkills[candidate.id] = snapshot;
        }
      }
      conflictsToCreate.push({
        room_id: roomId,
        round: workingRound,
        rank: nextRank,
        role_label: role,
        candidate_ids: candidates.map((c) => c.id),
        status: "choosing",
        candidate_skills: candidateSkills,
      });
    }
  }

  if (singleRows.length > 0) await supabase.from("role_assignments").insert(singleRows);
  await supabase.from("rooms").update({ conflict_rank: nextRank }).eq("id", roomId);

  if (conflictsToCreate.length > 0) {
    await supabase.from("role_conflicts").insert(conflictsToCreate);
    await supabase.from("rooms").update({ game_phase: "conflict" }).eq("id", roomId);
    return;
  }

  // 이번 지망 단계엔 충돌이 하나도 없었으면(전부 단독 지원이거나 아무도 안 골랐으면)
  // 사람을 기다릴 필요 없이 바로 다음 지망으로 넘어간다(락은 이미 쥐고 있으니 Inner를
  // 직접 부른다 — processNextRank를 다시 부르면 스스로 락에 걸려 멈춰버린다).
  return processNextRankInner(supabase, roomId);
}

async function finalizeConflict(
  supabase: ReturnType<typeof getSupabase>,
  conflict: {
    id: string;
    room_id: string;
    role_label: string;
    rank: number;
    round: number;
    candidate_skills: Record<string, SkillSnapshot> | null;
  },
  winnerId: string,
  reason: "priority" | "card" | "duel" | "draw"
): Promise<void> {
  const { data: winner } = await supabase.from("members").select("*").eq("id", winnerId).maybeSingle();
  if (!winner) return;

  // 충돌이 생길 때 이미 찍어둔 스냅샷을 그대로 쓴다 — 판정이 끝나는 사이 player_skills가
  // 바뀌어도(다른 탭에서 프로필을 고치는 등) 충돌 카드에 보여준 값과 결과가 어긋나지 않는다.
  const winnerSkill = conflict.candidate_skills?.[winnerId] ?? null;

  await supabase.from("role_assignments").insert({
    room_id: conflict.room_id,
    role_label: conflict.role_label,
    member_id: winner.id,
    member_name: winner.name,
    assigned_rank: conflict.rank,
    resolved_by: reason,
    round: conflict.round,
    skill_level: winnerSkill?.skill_level ?? null,
    preference_level: winnerSkill?.preference_level ?? null,
  });

  await supabase
    .from("role_conflicts")
    .update({ status: "resolved", winner_id: winner.id, winner_reason: reason })
    .eq("id", conflict.id);

  // 충돌을 뚫고 역할을 가져간 사람은 "이번에 유리했다"는 뜻이므로 기존 공정성 가중치
  // (last_picked_round)에도 반영한다 — 자기 지망을 그대로 받은 사람(무충돌)과 구분된다.
  await supabase.from("members").update({ last_picked_round: conflict.round }).eq("id", winner.id);

  await checkRoundProgress(supabase, conflict.room_id);
}

async function checkRoundProgress(supabase: ReturnType<typeof getSupabase>, roomId: string) {
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room || room.game_phase !== "conflict") return;

  const workingRound = room.round + 1;
  const { count } = await supabase
    .from("role_conflicts")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId)
    .eq("round", workingRound)
    .neq("status", "resolved");
  if ((count ?? 0) > 0) return; // 다른 역할의 충돌이 아직 안 끝났으면 기다린다.

  await processNextRank(supabase, roomId);
}

// 판정을 실제로 내려도 되는지 원자적으로 선점한다. 두 사람이 선택/가위바위보를 거의
// 동시에 제출하면 두 요청 모두 "이제 판정할 수 있다"고 볼 수 있는데, 그중 status를
// 실제로 바꾸는 데 성공한 요청만 판정을 진행하게 해서 같은 충돌이 두 번 끝나는(=같은
// 역할이 두 번 배정되는) 일을 막는다.
async function claimConflict(
  supabase: ReturnType<typeof getSupabase>,
  conflictId: string,
  fromStatus: string,
  toStatus: string
): Promise<boolean> {
  const { data } = await supabase
    .from("role_conflicts")
    .update({ status: toStatus })
    .eq("id", conflictId)
    .eq("status", fromStatus)
    .select("id");
  return (data?.length ?? 0) > 0;
}

// ------------------------------------------------------------------
// 여기부터 두 함수(decideChoosingTier/decideRpsWinner)는 "누가 이겼는지"만 계산하는
// 순수 함수다 — DB 접근이 전혀 없다. role_assignment/budget(쇼핑, 물건 담당 배정)의
// tryResolveConflict와, 아래 뭘 먹을까/뭐부터 할까/언제 만날까의 tryResolveDecisionConflict가
// 이 판정 규칙을 그대로 공유한다: "충돌 해결 부분만 공통으로 쓴다"는 원칙이 실제로
// 지켜지는 지점이 여기다. 세기는 우선권 > 카드 > 승부 순.
//   양보만 있으면(전원 양보): 승자 없음 -> 호출한 쪽이 각자 알아서 다음 단계로 이월
//   경쟁자가 1명만 남으면: 그 사람이 바로 승리
//   우선권 사용자가 있으면: 우선권 사용자끼리만(1명이면 바로 승리, 2명이면 가위바위보,
//     3명 이상이면 가중치 뽑기)
//   우선권 없이 카드 사용자가 있으면: 카드 사용자끼리만, 가위바위보로 가지 않고 항상
//     가중치 뽑기로 바로 정한다(승부/가위바위보와는 다른 결의 해결 수단이라는 걸
//     구분하기 위해서다)
//   전원 승부(우선권·카드 없이): 다 같이 가위바위보(2명 초과면 예외적으로 가중치 뽑기)
// ------------------------------------------------------------------

type ChoosingDecision =
  | { type: "no-contenders" }
  | { type: "winner"; winnerId: string; reason: "priority" | "card" | "duel" }
  | { type: "rps"; finalists: [string, string] }
  | { type: "draw"; finalists: string[]; reason: "card" | "draw" };

function decideChoosingTier(
  candidateIds: string[],
  choiceByMember: Map<string, { choice: ConflictChoice | null }>
): ChoosingDecision {
  const contenders = candidateIds.filter((id) => choiceByMember.get(id)?.choice !== "concede");
  if (contenders.length === 0) return { type: "no-contenders" };

  if (contenders.length === 1) {
    const choice = choiceByMember.get(contenders[0])?.choice;
    const reason = choice === "priority" ? "priority" : choice === "card" ? "card" : "duel";
    return { type: "winner", winnerId: contenders[0], reason };
  }

  const priorityUsers = contenders.filter((id) => choiceByMember.get(id)?.choice === "priority");
  const cardUsers = contenders.filter((id) => choiceByMember.get(id)?.choice === "card");
  const tier: "priority" | "card" | "duel" =
    priorityUsers.length > 0 ? "priority" : cardUsers.length > 0 ? "card" : "duel";
  const finalists = tier === "priority" ? priorityUsers : tier === "card" ? cardUsers : contenders;

  if (finalists.length === 1) return { type: "winner", winnerId: finalists[0], reason: tier };
  if (tier === "card") return { type: "draw", finalists, reason: "card" };
  if (finalists.length === 2) return { type: "rps", finalists: [finalists[0], finalists[1]] };
  return { type: "draw", finalists, reason: "draw" };
}

// 비겼으면 null(다시 내기), 아니면 승자 member id.
function decideRpsWinner(aId: string, bId: string, aMove: RpsMove, bMove: RpsMove): string | null {
  if (aMove === bMove) return null;
  const beats: Record<RpsMove, RpsMove> = { rock: "scissors", scissors: "paper", paper: "rock" };
  return beats[aMove] === bMove ? aId : bId;
}

async function tryResolveConflict(supabase: ReturnType<typeof getSupabase>, conflictId: string) {
  const { data: conflict } = await supabase
    .from("role_conflicts")
    .select("*")
    .eq("id", conflictId)
    .maybeSingle();
  if (!conflict || conflict.status === "resolved") return;

  const { data: choices } = await supabase
    .from("role_conflict_choices")
    .select("*")
    .eq("conflict_id", conflictId);
  const choiceByMember = new Map((choices ?? []).map((c) => [c.member_id as string, c]));

  if (conflict.status === "choosing") {
    const candidateIds: string[] = conflict.candidate_ids;
    const allChose = candidateIds.every((id) => choiceByMember.get(id)?.choice);
    if (!allChose) return;

    const decision = decideChoosingTier(candidateIds, choiceByMember);

    if (decision.type === "no-contenders") {
      // 전원 양보 — 이 역할은 이번 지망 단계에서 아무도 못 받는다(다음 지망에서
      // 각자의 다음 선호가 다시 조회되므로 별도 이월 처리가 필요 없다).
      if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
      await checkRoundProgress(supabase, conflict.room_id);
      return;
    }

    if (decision.type === "winner") {
      if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
      await finalizeConflict(supabase, conflict, decision.winnerId, decision.reason);
      return;
    }

    if (decision.type === "rps") {
      // 여기는 두 번 실행돼도 같은 finalist_ids로 같은 값을 덮어쓸 뿐이라 굳이 선점하지
      // 않는다(role_assignments에 새 행이 생기는 게 아니라서 중복 문제가 없다).
      await supabase
        .from("role_conflicts")
        .update({ status: "rps", finalist_ids: decision.finalists })
        .eq("id", conflictId);
      return;
    }

    // draw: 카드 동률(항상) 또는 3명 이상 동률(우선권/승부)을 가중치 뽑기로 바로 정리한다.
    if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
    const { data: members } = await supabase.from("members").select("*").in("id", decision.finalists);
    const winner = weightedPick((members ?? []) as Member[], conflict.round);
    await finalizeConflict(supabase, conflict, winner.id, decision.reason);
    return;
  }

  if (conflict.status === "rps") {
    const finalistIds: string[] = conflict.finalist_ids ?? [];
    const moves = finalistIds.map((id) => choiceByMember.get(id)?.rps_move);
    if (moves.some((m) => !m)) return;

    const [aId, bId] = finalistIds;
    const aMove = choiceByMember.get(aId)?.rps_move as RpsMove;
    const bMove = choiceByMember.get(bId)?.rps_move as RpsMove;
    const winnerId = decideRpsWinner(aId, bId, aMove, bMove);

    if (!winnerId) {
      // 비겼으면 다시 낸다(두 번 실행돼도 null로 다시 지우는 것뿐이라 안전하다).
      await supabase
        .from("role_conflict_choices")
        .update({ rps_move: null })
        .eq("conflict_id", conflictId)
        .in("member_id", finalistIds);
      return;
    }

    if (!(await claimConflict(supabase, conflictId, "rps", "resolved"))) return;
    const winnerChoice = choiceByMember.get(winnerId)?.choice;
    await finalizeConflict(supabase, conflict, winnerId, winnerChoice === "priority" ? "priority" : "duel");
  }
}

export async function resolveRoles(roomId: string) {
  const supabase = getSupabase();
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return { ok: false as const, error: "방을 찾을 수 없어요" };
  if (room.game_phase !== "preference") {
    return { ok: false as const, error: "지금은 확인할 수 없어요" };
  }

  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);
  if ((count ?? 0) < 2) return { ok: false as const, error: "참가자가 2명 이상 필요해요" };

  await processNextRank(supabase, roomId);
  return { ok: true as const };
}

// choice: 'priority'(우선권 사용) | 'concede'(양보) | 'duel'(승부) | 'card'(카드 사용).
export async function submitConflictChoice(
  roomId: string,
  conflictId: string,
  memberId: string,
  choice: "priority" | "concede" | "duel" | "card"
) {
  const supabase = getSupabase();

  if (choice === "priority") {
    const { data: member } = await supabase
      .from("members")
      .select("priority_token_used")
      .eq("id", memberId)
      .maybeSingle();
    if (member?.priority_token_used) {
      return { ok: false as const, error: "우선권을 이미 사용했어요" };
    }
    await supabase.from("members").update({ priority_token_used: true }).eq("id", memberId);
  }

  if (choice === "card") {
    const { data: member } = await supabase
      .from("members")
      .select("card_token_used")
      .eq("id", memberId)
      .maybeSingle();
    if (member?.card_token_used) {
      return { ok: false as const, error: "카드를 이미 사용했어요" };
    }
    await supabase.from("members").update({ card_token_used: true }).eq("id", memberId);
  }

  const { error } = await supabase
    .from("role_conflict_choices")
    .upsert(
      { room_id: roomId, conflict_id: conflictId, member_id: memberId, choice },
      { onConflict: "conflict_id,member_id" }
    );
  if (error) return { ok: false as const, error: "선택을 저장하지 못했어요" };

  const mode = await getConflictDecisionMode(supabase, conflictId);
  if (mode) await tryResolveDecisionConflict(supabase, conflictId, mode);
  else await tryResolveConflict(supabase, conflictId);
  return { ok: true as const };
}

export async function submitRpsMove(conflictId: string, memberId: string, move: "rock" | "paper" | "scissors") {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("role_conflict_choices")
    .update({ rps_move: move })
    .eq("conflict_id", conflictId)
    .eq("member_id", memberId);
  if (error) return { ok: false as const, error: "선택을 저장하지 못했어요" };

  const mode = await getConflictDecisionMode(supabase, conflictId);
  if (mode) await tryResolveDecisionConflict(supabase, conflictId, mode);
  else await tryResolveConflict(supabase, conflictId);
  return { ok: true as const };
}

// 이 충돌이 걸린 방이 뭘 먹을까/뭐부터 할까/언제 만날까(problemTypes.ts) 중 하나면 그
// 모드를, 아니면(팀 역할 정하기·쇼핑) null을 돌려준다 — role_conflicts/role_conflict_choices
// 테이블과 우선권·양보·승부·카드 선택 UI는 모든 문제 유형이 공유하지만, "충돌이 풀리면
// 뭘 써야 하는지"(사람에게 역할을 주는지, 그룹 전체의 답 하나를 정하는지, 순서 한 자리를
// 채우는지)만 문제 유형별로 다르다.
async function getConflictDecisionMode(
  supabase: ReturnType<typeof getSupabase>,
  conflictId: string
): Promise<DecisionMode | null> {
  const { data: conflict } = await supabase
    .from("role_conflicts")
    .select("room_id")
    .eq("id", conflictId)
    .maybeSingle();
  if (!conflict) return null;
  const { data: room } = await supabase.from("rooms").select("problem_type").eq("id", conflict.room_id).maybeSingle();
  return getDecisionMode(room?.problem_type ?? "");
}

// "다시 하기" / "다음 주 당번 정하기" — 같은 방·참가자로 새 게임 세션을 시작한다.
// role_assignments는 지우지 않고 그대로 둔다 — round 번호로 이미 구분되니 다음 라운드
// 계산에 영향을 주지 않고, 다음 finalize 단계의 "직전 역할 회피"가 이걸 참고하며,
// "📋 기록" 화면도 이 데이터를 라운드별로 묶어서 보여준다.
// role_preferences는 round 구분이 없는 "이번 라운드 진행 중" 데이터라 반드시 비워야
// 다음 라운드에 예전 선택이 섞여 들어가지 않는다.
// lobby로 되돌리는 건(예전엔 곧장 preference로 갔다) 매 게임마다 이번엔 어떤 역할을
// 쓸지 다시 고를 기회를 주기 위해서다 — active_roles는 그대로 남겨서 "지난번과 같은
// 역할"을 기본 선택값으로 보여줄 수 있게 한다.
export async function restartRound(roomId: string) {
  const supabase = getSupabase();
  await supabase.from("role_conflicts").delete().eq("room_id", roomId);
  await supabase.from("role_preferences").delete().eq("room_id", roomId);
  // 아직 응답 안 된 교환 제안은 새 라운드로 넘어가면 의미가 없어진다(대상 역할이 곧
  // 다시 정해지므로).
  await supabase.from("role_swap_proposals").delete().eq("room_id", roomId);
  await supabase
    .from("members")
    .update({ priority_token_used: false, card_token_used: false })
    .eq("room_id", roomId);
  await supabase.from("rooms").update({ game_phase: "lobby", conflict_rank: 0 }).eq("id", roomId);
}

// ============================================================
// 🍚 뭘 먹을까 / 📋 뭐부터 할까 / 🕐 언제 만날까 — "사람 : 역할 = 1:1"이 아니라
// "그룹 전체가 하나의 답으로 수렴"(뭘 먹을까/언제 만날까)하거나 "할 일들의 순서를
// 정한다"(뭐부터 할까)는 점이 팀 역할 정하기와 다르다. 그래서 processNextRank/
// finalizeConflict를 그대로 쓰지 않고 이 아래에 병렬 버전을 둔다 — 대신 판정 규칙
// (decideChoosingTier/decideRpsWinner)과 role_preferences/role_conflicts/
// role_conflict_choices/role_assignments 테이블, submitConflictChoice/submitRpsMove
// 진입점은 위 팀 역할 정하기와 완전히 같은 것을 공유한다("충돌 해결 부분만 공통").
// 🛍️ 뭘 살까(budget)는 여기 안 낀다 — "물건 하나를 한 사람에게 배정"하는 것뿐이라
// 팀 역할 정하기 엔진을 그대로 쓴다(situations.ts의 SHOPPING_SITUATION 참고).
// ============================================================

export async function startDecisionGame(roomId: string, candidates: string[]) {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);
  if ((count ?? 0) < 2) return { ok: false as const, error: "참가자가 2명 이상 필요해요" };
  if (candidates.length < 2) return { ok: false as const, error: "후보가 2개 이상 필요해요" };

  const { error } = await supabase
    .from("rooms")
    .update({ game_phase: "preference", conflict_rank: 0, active_roles: candidates })
    .eq("id", roomId)
    .eq("game_phase", "lobby");
  if (error) return { ok: false as const, error: "시작하지 못했어요" };
  return { ok: true as const };
}

export async function resolveDecision(roomId: string) {
  const supabase = getSupabase();
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return { ok: false as const, error: "방을 찾을 수 없어요" };
  if (room.game_phase !== "preference") return { ok: false as const, error: "지금은 확인할 수 없어요" };

  const mode = getDecisionMode(room.problem_type);
  if (!mode) return { ok: false as const, error: "지원하지 않는 게임이에요" };

  if (mode === "single-choice") await startSingleChoiceRound(supabase, roomId);
  else await processNextPosition(supabase, roomId);
  return { ok: true as const };
}

// 멤버가 남은 후보(remaining) 중 자기가 매긴 순위가 가장 높은(숫자가 작은) 항목을
// 돌려준다 — 뭘 먹을까에선 remaining이 항상 전체 후보라 곧 "1지망"과 같고, 뭐부터
// 할까에선 앞 순번들이 빠질수록 이 값이 그 사람의 2·3지망으로 자연스럽게 넘어간다.
function effectiveItemForMember(
  memberId: string,
  prefs: { member_id: string; role_label: string; rank: number }[],
  remaining: string[]
): string | null {
  const mine = prefs
    .filter((p) => p.member_id === memberId && remaining.includes(p.role_label))
    .sort((a, b) => a.rank - b.rank);
  return mine[0]?.role_label ?? null;
}

async function startSingleChoiceRound(supabase: ReturnType<typeof getSupabase>, roomId: string): Promise<void> {
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  const { data: members } = await supabase.from("members").select("*").eq("room_id", roomId);
  const { data: prefs } = await supabase.from("role_preferences").select("*").eq("room_id", roomId);
  if (!room || !members || !prefs) return;

  const workingRound = room.round + 1;
  const byItem = new Map<string, Member[]>();
  for (const p of prefs) {
    if (p.rank !== 1) continue;
    const member = members.find((m) => m.id === p.member_id);
    if (!member) continue;
    if (!byItem.has(p.role_label)) byItem.set(p.role_label, []);
    byItem.get(p.role_label)!.push(member);
  }
  if (byItem.size === 0) return; // 아무도 1지망을 안 골랐으면 할 수 있는 게 없다.

  const maxCount = Math.max(...[...byItem.values()].map((list) => list.length));
  const leaders = [...byItem.entries()].filter(([, list]) => list.length === maxCount);

  if (leaders.length === 1) {
    await finalizeSharedDecision(supabase, roomId, members, prefs, leaders[0][0], "preference", workingRound);
    return;
  }

  // 1지망이 갈린 항목끼리 충돌 — 각 항목을 고른 사람 중 가장 먼저 참가한 사람이
  // 그 항목의 "대표"로 우선권/양보/승부/카드를 선택한다(같은 항목을 고른 사람끼리는
  // 어차피 원하는 결과가 같으므로 대표 한 명만 있으면 된다).
  const representatives = leaders.map(
    ([, list]) => [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  );
  await supabase.from("role_conflicts").insert({
    room_id: roomId,
    round: workingRound,
    rank: 1,
    role_label: leaders.map(([item]) => item).join(" vs "),
    candidate_ids: representatives.map((m) => m.id),
    status: "choosing",
  });
  await supabase.from("rooms").update({ game_phase: "conflict", conflict_rank: 1 }).eq("id", roomId);
}

// 뭘 먹을까/언제 만날까의 최종 확정 — 이긴 항목 하나를 room_assignments에 "참가자 전원"
// 몫으로 넣는다(다 같이 같은 답을 받는 게 목적이므로). assigned_rank는 각자 그 항목을
// 몇 지망으로 골랐는지(안 골랐으면 null="비선호") — 개인화된 배지를 결과 화면에 그대로
// 재사용할 수 있게 해준다.
async function finalizeSharedDecision(
  supabase: ReturnType<typeof getSupabase>,
  roomId: string,
  members: Member[],
  prefs: { member_id: string; role_label: string; rank: number }[],
  item: string,
  reason: "preference" | "priority" | "card" | "duel" | "draw",
  workingRound: number
): Promise<void> {
  const rows = members.map((m) => {
    const mine = prefs.find((p) => p.member_id === m.id && p.role_label === item);
    return {
      room_id: roomId,
      role_label: item,
      member_id: m.id,
      member_name: m.name,
      assigned_rank: mine?.rank ?? null,
      resolved_by: reason,
      round: workingRound,
    };
  });
  await supabase.from("role_assignments").insert(rows);
  await supabase.from("rooms").update({ game_phase: "result", round: workingRound, conflict_rank: 0 }).eq("id", roomId);
}

// 뭐부터 할까 — 팀 역할 정하기의 processNextRank/claimAdvance 락을 그대로 재사용해서
// "한 자리(포지션)씩" 순서를 채운다. 다른 점은 "역할을 사람에게" 대신 "포지션(1번째,
// 2번째, ...)을 항목에" 배정한다는 것뿐이다.
async function processNextPosition(supabase: ReturnType<typeof getSupabase>, roomId: string): Promise<void> {
  const claimed = await claimAdvance(supabase, roomId);
  if (!claimed) return;
  try {
    await processNextPositionInner(supabase, roomId);
  } finally {
    await supabase.from("rooms").update({ advancing: false }).eq("id", roomId);
  }
}

async function processNextPositionInner(supabase: ReturnType<typeof getSupabase>, roomId: string): Promise<void> {
  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room || (room.game_phase !== "preference" && room.game_phase !== "conflict")) return;

  const items: string[] = room.active_roles ?? [];
  if (items.length === 0) return;

  const workingRound = room.round + 1;
  const { data: placed } = await supabase
    .from("role_assignments")
    .select("role_label")
    .eq("room_id", roomId)
    .eq("round", workingRound);
  const placedItems = new Set((placed ?? []).map((p) => p.role_label));
  const remaining = items.filter((item) => !placedItems.has(item));
  const nextPosition = (placed?.length ?? 0) + 1;
  const maxPositions = Math.min(3, items.length);

  if (remaining.length === 0) {
    await supabase
      .from("rooms")
      .update({ game_phase: "result", round: workingRound, conflict_rank: 0 })
      .eq("id", roomId);
    return;
  }

  // 3순위까지만 실제로 겨루고(스펙의 🥇🥈🥉), 그 이후 남는 항목이나 아무도 원하지
  // 않는 항목은 복잡한 알고리즘 없이 순서대로 채운다.
  if (remaining.length === 1 || nextPosition > maxPositions) {
    const rows = remaining.map((item, i) => ({
      room_id: roomId,
      role_label: item,
      member_id: null,
      member_name: "",
      assigned_rank: nextPosition + i,
      resolved_by: "draw" as const,
      round: workingRound,
    }));
    await supabase.from("role_assignments").insert(rows);
    await supabase
      .from("rooms")
      .update({ game_phase: "result", round: workingRound, conflict_rank: 0 })
      .eq("id", roomId);
    return;
  }

  const { data: members } = await supabase.from("members").select("*").eq("room_id", roomId);
  const { data: prefs } = await supabase.from("role_preferences").select("*").eq("room_id", roomId);
  if (!members || !prefs) return;

  const byItem = new Map<string, Member[]>();
  for (const member of members) {
    const item = effectiveItemForMember(member.id, prefs, remaining);
    if (!item) continue;
    if (!byItem.has(item)) byItem.set(item, []);
    byItem.get(item)!.push(member);
  }

  if (byItem.size === 0) {
    // 아무도 남은 항목 중 선호를 안 남겼으면 그냥 순서대로 채우고 끝낸다.
    const rows = remaining.map((item, i) => ({
      room_id: roomId,
      role_label: item,
      member_id: null,
      member_name: "",
      assigned_rank: nextPosition + i,
      resolved_by: "draw" as const,
      round: workingRound,
    }));
    await supabase.from("role_assignments").insert(rows);
    await supabase
      .from("rooms")
      .update({ game_phase: "result", round: workingRound, conflict_rank: 0 })
      .eq("id", roomId);
    return;
  }

  const maxCount = Math.max(...[...byItem.values()].map((list) => list.length));
  const leaders = [...byItem.entries()].filter(([, list]) => list.length === maxCount);

  if (leaders.length === 1) {
    await supabase.from("role_assignments").insert({
      room_id: roomId,
      role_label: leaders[0][0],
      member_id: null,
      member_name: "",
      assigned_rank: nextPosition,
      resolved_by: "preference",
      round: workingRound,
    });
    return processNextPositionInner(supabase, roomId);
  }

  const representatives = leaders.map(
    ([, list]) => [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  );
  await supabase.from("role_conflicts").insert({
    room_id: roomId,
    round: workingRound,
    rank: nextPosition,
    role_label: leaders.map(([item]) => item).join(" vs "),
    candidate_ids: representatives.map((m) => m.id),
    status: "choosing",
  });
  await supabase.from("rooms").update({ game_phase: "conflict", conflict_rank: nextPosition }).eq("id", roomId);
}

async function tryResolveDecisionConflict(
  supabase: ReturnType<typeof getSupabase>,
  conflictId: string,
  mode: DecisionMode
): Promise<void> {
  const { data: conflict } = await supabase
    .from("role_conflicts")
    .select("*")
    .eq("id", conflictId)
    .maybeSingle();
  if (!conflict || conflict.status === "resolved") return;

  const { data: choices } = await supabase
    .from("role_conflict_choices")
    .select("*")
    .eq("conflict_id", conflictId);
  const choiceByMember = new Map((choices ?? []).map((c) => [c.member_id as string, c]));

  if (conflict.status === "choosing") {
    const candidateIds: string[] = conflict.candidate_ids;
    const allChose = candidateIds.every((id) => choiceByMember.get(id)?.choice);
    if (!allChose) return;

    const decision = decideChoosingTier(candidateIds, choiceByMember);

    if (decision.type === "no-contenders") {
      // 대표 전원이 양보하면(=아무도 자기 항목을 고집하지 않으면) 무한정 기다릴 수
      // 없으니 원래 후보 전원 중 가중치 뽑기로 강제 진행한다.
      if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
      const { data: members } = await supabase.from("members").select("*").in("id", candidateIds);
      const winner = weightedPick((members ?? []) as Member[], conflict.round);
      await finalizeDecisionWinner(supabase, conflict, winner.id, "draw", mode);
      return;
    }

    if (decision.type === "winner") {
      if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
      await finalizeDecisionWinner(supabase, conflict, decision.winnerId, decision.reason, mode);
      return;
    }

    if (decision.type === "rps") {
      await supabase
        .from("role_conflicts")
        .update({ status: "rps", finalist_ids: decision.finalists })
        .eq("id", conflictId);
      return;
    }

    if (!(await claimConflict(supabase, conflictId, "choosing", "resolved"))) return;
    const { data: members } = await supabase.from("members").select("*").in("id", decision.finalists);
    const winner = weightedPick((members ?? []) as Member[], conflict.round);
    await finalizeDecisionWinner(supabase, conflict, winner.id, decision.reason, mode);
    return;
  }

  if (conflict.status === "rps") {
    const finalistIds: string[] = conflict.finalist_ids ?? [];
    const moves = finalistIds.map((id) => choiceByMember.get(id)?.rps_move);
    if (moves.some((m) => !m)) return;

    const [aId, bId] = finalistIds;
    const aMove = choiceByMember.get(aId)?.rps_move as RpsMove;
    const bMove = choiceByMember.get(bId)?.rps_move as RpsMove;
    const winnerId = decideRpsWinner(aId, bId, aMove, bMove);

    if (!winnerId) {
      await supabase
        .from("role_conflict_choices")
        .update({ rps_move: null })
        .eq("conflict_id", conflictId)
        .in("member_id", finalistIds);
      return;
    }

    if (!(await claimConflict(supabase, conflictId, "rps", "resolved"))) return;
    const winnerChoice = choiceByMember.get(winnerId)?.choice;
    await finalizeDecisionWinner(supabase, conflict, winnerId, winnerChoice === "priority" ? "priority" : "duel", mode);
  }
}

async function finalizeDecisionWinner(
  supabase: ReturnType<typeof getSupabase>,
  conflict: { id: string; room_id: string; round: number; rank: number },
  winnerId: string,
  reason: "priority" | "card" | "duel" | "draw",
  mode: DecisionMode
): Promise<void> {
  const { data: prefs } = await supabase.from("role_preferences").select("*").eq("room_id", conflict.room_id);
  if (!prefs) return;

  if (mode === "single-choice") {
    const { data: members } = await supabase.from("members").select("*").eq("room_id", conflict.room_id);
    if (!members) return;
    const mine = prefs.filter((p) => p.member_id === winnerId).sort((a, b) => a.rank - b.rank);
    const item = mine[0]?.role_label;
    if (!item) return;

    await supabase
      .from("role_conflicts")
      .update({ status: "resolved", winner_id: winnerId, winner_reason: reason })
      .eq("id", conflict.id);
    await finalizeSharedDecision(supabase, conflict.room_id, members, prefs, item, reason, conflict.round);
    return;
  }

  // ordering: 이긴 대표가 "지금 시점에" 남은 항목 중 가장 원했던 항목을 이번 포지션에 채운다.
  const { data: room } = await supabase.from("rooms").select("*").eq("id", conflict.room_id).maybeSingle();
  const { data: placed } = await supabase
    .from("role_assignments")
    .select("role_label")
    .eq("room_id", conflict.room_id)
    .eq("round", conflict.round);
  if (!room) return;
  const placedItems = new Set((placed ?? []).map((p) => p.role_label));
  const remaining = (room.active_roles ?? []).filter((item: string) => !placedItems.has(item));
  const item = effectiveItemForMember(winnerId, prefs, remaining);
  if (!item) return;

  await supabase
    .from("role_conflicts")
    .update({ status: "resolved", winner_id: winnerId, winner_reason: reason })
    .eq("id", conflict.id);
  await supabase.from("role_assignments").insert({
    room_id: conflict.room_id,
    role_label: item,
    member_id: null,
    member_name: "",
    assigned_rank: conflict.rank,
    resolved_by: reason,
    round: conflict.round,
  });
  await processNextPosition(supabase, conflict.room_id);
}

// ============================================================
// 결과 확정 후 역할 교환 — 두 참가자가 서로 다른 역할을 받았을 때, 한쪽이 제안하고
// 다른 쪽이 수락해야만(양쪽 동의) role_assignments.role_label을 맞바꾼다. 능력/선호
// 스냅샷도 각자 "새로 받는 역할" 기준으로 다시 찍는다 — 역할마다 연결된 능력 카테고리가
// 다를 수 있어서 그냥 두 값을 맞바꾸면 엉뚱한 능력이 표시될 수 있기 때문이다.
// ============================================================

export async function proposeSwap(roomId: string, round: number, proposerId: string, targetId: string) {
  if (proposerId === targetId) return { ok: false as const, error: "자기 자신과는 교환할 수 없어요" };
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("role_swap_proposals")
    .select("id")
    .eq("room_id", roomId)
    .eq("round", round)
    .eq("status", "pending")
    .or(`proposer_id.eq.${proposerId},target_id.eq.${proposerId}`);
  if (existing && existing.length > 0) {
    return { ok: false as const, error: "이미 진행 중인 교환 제안이 있어요" };
  }

  const { error } = await supabase.from("role_swap_proposals").insert({
    room_id: roomId,
    round,
    proposer_id: proposerId,
    target_id: targetId,
    status: "pending",
  });
  if (error) return { ok: false as const, error: "제안을 보내지 못했어요" };
  return { ok: true as const };
}

export async function cancelSwapProposal(proposalId: string, memberId: string) {
  const supabase = getSupabase();
  const { data: proposal } = await supabase
    .from("role_swap_proposals")
    .select("proposer_id, status")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal || proposal.proposer_id !== memberId || proposal.status !== "pending") {
    return { ok: false as const, error: "취소할 수 없어요" };
  }
  await supabase.from("role_swap_proposals").delete().eq("id", proposalId);
  return { ok: true as const };
}

export async function respondToSwap(proposalId: string, responderId: string, accept: boolean) {
  const supabase = getSupabase();
  const { data: proposal } = await supabase
    .from("role_swap_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal || proposal.status !== "pending" || proposal.target_id !== responderId) {
    return { ok: false as const, error: "응답할 수 없는 제안이에요" };
  }

  if (!accept) {
    await supabase.from("role_swap_proposals").update({ status: "declined" }).eq("id", proposalId);
    return { ok: true as const };
  }

  const { data: room } = await supabase.from("rooms").select("*").eq("id", proposal.room_id).maybeSingle();
  if (!room) return { ok: false as const, error: "방을 찾을 수 없어요" };
  const situationInfo = findSituation(room.situation);

  const { data: assignments } = await supabase
    .from("role_assignments")
    .select("*")
    .eq("room_id", proposal.room_id)
    .eq("round", proposal.round)
    .in("member_id", [proposal.proposer_id, proposal.target_id]);
  const proposerRow = (assignments ?? []).find((a) => a.member_id === proposal.proposer_id);
  const targetRow = (assignments ?? []).find((a) => a.member_id === proposal.target_id);
  if (!proposerRow || !targetRow) {
    return { ok: false as const, error: "교환할 역할을 찾을 수 없어요" };
  }

  // 서로 새로 받는 역할 기준으로 능력/선호 스냅샷을 다시 찍는다.
  let proposerNewSkill: SkillSnapshot | null = null;
  let targetNewSkill: SkillSnapshot | null = null;
  if (situationInfo) {
    const targetRoleSkill = await getRoleSkillCategory(supabase, proposal.room_id, situationInfo.situation, targetRow.role_label);
    const proposerRoleSkill = await getRoleSkillCategory(supabase, proposal.room_id, situationInfo.situation, proposerRow.role_label);
    proposerNewSkill = await getSkillSnapshot(supabase, proposal.room_id, proposal.proposer_id, targetRoleSkill);
    targetNewSkill = await getSkillSnapshot(supabase, proposal.room_id, proposal.target_id, proposerRoleSkill);
  }

  await supabase
    .from("role_assignments")
    .update({
      role_label: targetRow.role_label,
      resolved_by: "trade",
      skill_level: proposerNewSkill?.skill_level ?? null,
      preference_level: proposerNewSkill?.preference_level ?? null,
    })
    .eq("id", proposerRow.id);
  await supabase
    .from("role_assignments")
    .update({
      role_label: proposerRow.role_label,
      resolved_by: "trade",
      skill_level: targetNewSkill?.skill_level ?? null,
      preference_level: targetNewSkill?.preference_level ?? null,
    })
    .eq("id", targetRow.id);

  await supabase.from("role_swap_proposals").update({ status: "accepted" }).eq("id", proposalId);
  // 둘 중 한쪽이 걸린 다른 대기 중인 제안은 더 이상 유효하지 않다(역할이 이미 바뀌었으니).
  await supabase
    .from("role_swap_proposals")
    .update({ status: "declined" })
    .eq("room_id", proposal.room_id)
    .eq("round", proposal.round)
    .eq("status", "pending")
    .or(`proposer_id.eq.${proposal.proposer_id},target_id.eq.${proposal.proposer_id},proposer_id.eq.${proposal.target_id},target_id.eq.${proposal.target_id}`);

  return { ok: true as const };
}
