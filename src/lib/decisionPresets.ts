// src/lib/decisionPresets.ts — "역할 정하기"처럼 사람에게 뭔가를 배정하는 게 아니라,
// 그룹 전체가 하나의 답(뭘 먹을지/언제 만날지)이나 순서(뭐부터 할지)로 수렴하는 세 가지
// 문제 유형의 카탈로그. situations.ts의 Situation과 다른 모양인 이유는 이 문제들의
// "결과"가 사람 : 역할 = 1:1이 아니라 "그룹 : 하나의 답" 또는 "할 일들의 순서"이기
// 때문이다 — 충돌 해결 엔진(우선권/양보/승부/카드)만 role_assignment와 공유한다.

export type DecisionMode = "single-choice" | "ordering";

export interface DecisionPreset {
  id: string;
  problemType: "decision" | "time_management" | "scheduling";
  label: string;
  mode: DecisionMode;
  candidates: string[];
  resultTitle: string;
}

export const DECISION_PRESETS: DecisionPreset[] = [
  {
    id: "food-default",
    problemType: "decision",
    label: "오늘 뭐 먹지?",
    mode: "single-choice",
    candidates: ["🍗 치킨", "🍕 피자", "🍜 국밥", "🍣 초밥", "🍔 버거"],
    resultTitle: "오늘의 메뉴",
  },
  {
    id: "priority-default",
    problemType: "time_management",
    label: "오늘 뭐부터 할까?",
    mode: "ordering",
    candidates: ["🧹 청소", "🛒 장보기", "🧺 빨래", "🍽️ 설거지", "📚 공부"],
    resultTitle: "할 일 순서",
  },
  {
    id: "schedule-default",
    problemType: "scheduling",
    label: "언제 만날까?",
    mode: "single-choice",
    candidates: ["14:00", "16:00", "18:00", "20:00"],
    resultTitle: "최종 약속 시간",
  },
];

export function findDecisionPreset(situationId: string | null | undefined): DecisionPreset | null {
  if (!situationId) return null;
  return DECISION_PRESETS.find((p) => p.id === situationId) ?? null;
}

export function getDecisionMode(problemType: string): DecisionMode | null {
  const preset = DECISION_PRESETS.find((p) => p.problemType === problemType);
  return preset?.mode ?? null;
}
