// src/lib/types.ts — supabase/schema.sql의 테이블 구조와 1:1로 맞춘 타입.

export interface Room {
  id: string;
  slug: string;
  task: string;
  round: number;
  created_at: string;
}

export interface Member {
  id: string;
  room_id: string;
  name: string;
  last_picked_round: number;
  created_at: string;
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

// 가중치 = 1 + (현재 라운드 - 마지막으로 뽑힌 라운드). 서버(draw_winner RPC)와 클라이언트
// (확률 막대 미리보기)가 반드시 같은 공식을 써야 화면에 보이는 확률과 실제 결과가 일치한다.
export function weightOf(member: Pick<Member, "last_picked_round">, currentRound: number): number {
  return 1 + (currentRound - member.last_picked_round);
}
