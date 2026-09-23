// src/lib/types.ts — supabase/schema.sql의 테이블 구조와 1:1로 맞춘 타입.

export interface Room {
  id: string;
  slug: string;
  task: string;
  round: number;
  created_at: string;
  // 문제 유형/상황 선택 단계에서 채워진다. 기존 데이터는 problem_type이 기본값
  // 'role_assignment'로 채워지고 situation은 null일 수 있다.
  problem_type: string;
  situation: string | null;
  // 'lobby' | 'preference' | 'conflict' | 'result' — situation이 situations.ts 프리셋과
  // 매칭되는 방에서만 의미가 있다(매칭 안 되면 예전 RoomView를 그대로 쓰고 이 값은 무시).
  game_phase: string;
  // 지금 라운드에서 몇 지망까지 처리했는지(충돌 해결이 여러 지망에 걸쳐 진행된다).
  conflict_rank: number;
  // 다음 지망으로 넘어가는 중 락(동시성 방지용) — 화면에서는 쓰지 않는다.
  advancing: boolean;
  // 이번 게임에서 실제로 쓰기로 고른 역할 이름들(추천 역할 + 커스텀 역할 중 체크된 것).
  // null/빈 배열이면 아직 한 번도 안 골라본 방이라 추천 역할 전체를 기본값으로 쓴다.
  active_roles: string[] | null;
}

export interface Member {
  id: string;
  room_id: string;
  name: string;
  last_picked_round: number;
  created_at: string;
  // 역할 충돌 시 쓸 수 있는 우선권을 이미 썼는지 — 라운드마다 1개, restartRound에서 초기화.
  priority_token_used: boolean;
  // 🃏 카드(우선권보다 약하고 승부보다 강한 충돌 해결 수단)를 이미 썼는지 — 마찬가지로
  // 라운드마다 1개, restartRound에서 초기화.
  card_token_used: boolean;
}

export interface Draw {
  id: string;
  room_id: string;
  member_id: string | null;
  member_name: string;
  task: string;
  round: number;
  created_at: string;
}

// 가중치 = 1 + (현재 라운드 - 마지막으로 뽑힌 라운드). 서버(draw_winner RPC, resolveRoles)와
// 클라이언트(확률 막대 미리보기)가 반드시 같은 공식을 써야 화면에 보이는 확률과 실제
// 결과가 일치한다.
export function weightOf(member: Pick<Member, "last_picked_round">, currentRound: number): number {
  return 1 + (currentRound - member.last_picked_round);
}

export interface RolePreference {
  id: string;
  room_id: string;
  member_id: string;
  role_label: string;
  rank: number;
  created_at: string;
}

export interface RoleAssignment {
  id: string;
  room_id: string;
  role_label: string;
  member_id: string | null;
  member_name: string;
  // 몇 지망이 반영됐는지 — 비선호 역할로 배정되면 null.
  assigned_rank: number | null;
  // 'preference'=충돌 없이 그대로, 'priority'=우선권으로 획득, 'card'=카드로 획득,
  // 'duel'=승부(가위바위보 포함)로 획득, 'draw'=마지막 무작위 매칭(비선호) 또는 3명
  // 이상 동률 시 뽑기, 'trade'=결과 확정 후 다른 참가자와 역할을 맞바꿈.
  resolved_by: "preference" | "priority" | "card" | "duel" | "draw" | "trade";
  round: number;
  created_at: string;
  // 이 역할에 연결된 능력이 있으면 배정 시점의 능력/선호 스냅샷(둘 다 0~3). 연결된
  // 능력이 없으면 둘 다 null — "능력/선호는 참고 정보일 뿐 결과를 정하지 않는다"는
  // 원칙대로, 이 값은 표시 전용이고 배정 로직에는 관여하지 않는다.
  skill_level: number | null;
  preference_level: number | null;
  // 이 라운드가 어떤 주제(rooms.problem_type)로 진행됐는지 스냅샷 — "🔀 주제 바꾸기"로
  // 나중에 방의 주제가 바뀌어도 지난 기록은 그때 주제 그대로 보여야 하기 때문. 이
  // 기능 이전에 만들어진 기록은 null일 수 있다(그럴 땐 지금 방의 주제로 대체 표시).
  game_type: string | null;
}

export type ConflictChoice = "priority" | "concede" | "duel" | "card";
export type RpsMove = "rock" | "paper" | "scissors";

export interface SkillSnapshot {
  skill_level: number;
  preference_level: number;
}

export interface RoleConflict {
  id: string;
  room_id: string;
  round: number;
  rank: number;
  role_label: string;
  candidate_ids: string[];
  finalist_ids: string[] | null;
  status: "choosing" | "rps" | "resolved";
  winner_id: string | null;
  winner_reason: "priority" | "card" | "duel" | "draw" | null;
  created_at: string;
  // 충돌이 생긴 시점의 후보별 능력/선호 스냅샷: { [member_id]: {skill_level, preference_level} }.
  // 연결된 능력이 없는 역할이면 null.
  candidate_skills: Record<string, SkillSnapshot> | null;
}

export interface RoleConflictChoice {
  id: string;
  room_id: string;
  conflict_id: string;
  member_id: string;
  choice: ConflictChoice | null;
  rps_move: RpsMove | null;
  created_at: string;
}

// 사용자가 방에서 직접 만든 역할("내 역할"). situations.ts의 고정 문자열 목록은
// "추천 역할"로 남고, 이건 그 위에 얹는 방별 커스텀 역할이다.
export interface CustomRole {
  id: string;
  room_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 이 역할과 연결된 능력 카테고리(situations.ts의 skills 중 하나) — 없어도 된다.
  skill_category: string | null;
}

// 플레이어가 스스로 매기는 능력/선호("지금의 프로필"). 게임 도중 자유롭게 고칠 수
// 있고, 이미 끝난 게임 기록은 이 값을 실시간 참조하지 않는다 — 대신 role_conflicts/
// role_assignments에 그 순간의 값이 스냅샷으로 복사된다.
export interface PlayerSkill {
  id: string;
  room_id: string;
  member_id: string;
  skill_category: string;
  // 0(미설정)~3.
  skill_level: number;
  preference_level: number;
  updated_at: string;
}

// 결과 확정 후 "이 역할 서로 바꿀래?" 제안. 제안자(proposer)가 대상(target)에게 보내고,
// 대상이 수락하면 두 사람의 role_assignments.role_label을 맞바꾼다(양쪽 동의 필요 —
// 한쪽 마음대로 못 바꾼다).
export interface RoleSwapProposal {
  id: string;
  room_id: string;
  round: number;
  proposer_id: string;
  target_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
}
