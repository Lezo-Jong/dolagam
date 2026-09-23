// src/lib/problemTypes.ts — 이 서비스가 다루는 "일상 문제" 카탈로그.
// 지금은 role_assignment 하나만 실제로 만들 수 있고(enabled: true), 나머지는 카드로
// 보여만 주고 막아둔다. 새 문제 유형을 추가할 때는 이 배열에 항목만 추가하면 된다 —
// rooms.problem_type 컬럼이 이 id를 그대로 저장한다.

export type ProblemTypeId =
  | "role_assignment"
  | "decision"
  | "time_management"
  | "budget"
  | "scheduling";

export interface ProblemType {
  id: ProblemTypeId;
  label: string;
  emoji: string;
  description: string;
  enabled: boolean;
}

export const PROBLEM_TYPES: ProblemType[] = [
  {
    id: "role_assignment",
    label: "누가 어떤 일을 맡을까?",
    emoji: "👥",
    description: "역할과 업무를 공평하게 나눠요",
    enabled: true,
  },
  {
    id: "decision",
    label: "뭘 먹을까? 어디 갈까?",
    emoji: "🍴",
    description: "메뉴·장소 고르기",
    enabled: false,
  },
  {
    id: "time_management",
    label: "뭐부터 할까?",
    emoji: "⏰",
    description: "할 일 우선순위 정하기",
    enabled: false,
  },
  {
    id: "budget",
    label: "뭘 살까?",
    emoji: "💰",
    description: "예산 안에서 소비 정하기",
    enabled: false,
  },
  {
    id: "scheduling",
    label: "언제 만날까?",
    emoji: "📅",
    description: "일정 맞추기",
    enabled: false,
  },
];
