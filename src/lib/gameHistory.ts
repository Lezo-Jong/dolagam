// src/lib/gameHistory.ts — 📋 기록 화면이 라운드 하나(role_assignments를 round로 묶은
// 것)를 어떻게 보여줄지 정하는 공용 헬퍼. "🔀 주제 바꾸기"가 생기면서 한 방의 기록에
// 서로 다른 주제(팀 역할 정하기/뭘 먹을까/뭐부터 할까/...)의 라운드가 섞일 수 있게
// 됐다 — 그래서 지금 화면에 떠 있는 컴포넌트(RoleGameView/DecisionGameView)가 자기
// 모드라고 가정하고 렌더링하면 안 되고, 라운드마다 실제 저장된 데이터 모양을 보고
// 판단해야 한다. RoleGameView/DecisionGameView의 기록 화면이 이 함수 하나를 같이 쓴다.
import { PROBLEM_TYPES } from "./problemTypes";
import type { RoleAssignment } from "./types";

export function problemTypeLabel(gameType: string | null | undefined, fallback: string): string {
  if (!gameType) return fallback;
  const found = PROBLEM_TYPES.find((p) => p.id === gameType);
  return found?.label ?? fallback;
}

export type RoundSummary =
  | { kind: "per-member"; lines: string[] }
  | { kind: "shared"; result: string }
  | { kind: "ordered"; items: string[] };

// 라운드 하나(같은 round 번호를 가진 role_assignments 행들)의 모양을 보고 판단한다:
//   member_id가 전부 null -> 순서 정하기(뭐부터 할까) -> 항목 목록을 순서대로.
//   전원이 같은 role_label -> 그룹 전체가 하나로 정한 값(뭘 먹을까/언제 만날까).
//   그 외(각자 다른 role_label) -> 사람마다 다른 결과(팀 역할 정하기/뭘 살까).
export function summarizeRound(rows: RoleAssignment[]): RoundSummary {
  const memberRows = rows.filter((r) => r.member_id != null);

  if (memberRows.length === 0) {
    const sorted = [...rows].sort((a, b) => (a.assigned_rank ?? 99) - (b.assigned_rank ?? 99));
    return { kind: "ordered", items: sorted.map((r) => r.role_label) };
  }

  const uniqueLabels = new Set(memberRows.map((r) => r.role_label));
  if (uniqueLabels.size === 1 && memberRows.length > 1) {
    return { kind: "shared", result: [...uniqueLabels][0] };
  }

  return { kind: "per-member", lines: memberRows.map((r) => `${r.member_name} → ${r.role_label}`) };
}
