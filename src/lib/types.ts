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
}

export interface Member {
  id: string;
  room_id: string;
  name: string;
  last_picked_round: number;
  created_at: string;
  // 역할 충돌 시 쓸 수 있는 우선권을 이미 썼는지 — 라운드마다 1개, restartRound에서 초기화.
  priority_token_used: boolean;
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
  // 'preference'=충돌 없이 그대로, 'priority'=우선권으로 획득, 'duel'=승부(가위바위보
  // 포함)로 획득, 'draw'=마지막 무작위 매칭(비선호) 또는 3명 이상 동률 시 뽑기.
  resolved_by: "preference" | "priority" | "duel" | "draw";
  round: number;
  created_at: string;
}

export type ConflictChoice = "priority" | "concede" | "duel";
export type RpsMove = "rock" | "paper" | "scissors";

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
  winner_reason: "priority" | "duel" | "draw" | null;
  created_at: string;
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
