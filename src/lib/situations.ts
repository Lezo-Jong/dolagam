// src/lib/situations.ts — "상황" + 그 상황에서 나눠 맡을 "역할 풀" 카탈로그.
// 하드코딩된 페이지 대신 이 데이터 구조에 항목을 추가/수정하는 것만으로 상황과 역할을
// 늘릴 수 있다. 방장이 역할을 직접 편집하는 UI는 다음 단계 — 지금은 상황을 고르면
// 이 프리셋 role 목록이 그대로 방의 역할 풀이 된다.

export interface Situation {
  id: string;
  label: string;
  roles: string[];
}

export interface SituationCategory {
  id: string;
  label: string;
  emoji: string;
  situations: Situation[];
}

export const SITUATION_CATEGORIES: SituationCategory[] = [
  {
    id: "college",
    label: "대학",
    emoji: "🎓",
    situations: [
      {
        id: "team-project",
        label: "팀플",
        roles: ["발표", "자료조사", "PPT·디자인", "개발·실습"],
      },
      {
        id: "presentation",
        label: "발표 준비",
        roles: ["대본 작성", "슬라이드 제작", "리허설 진행", "Q&A 준비"],
      },
    ],
  },
  {
    id: "work",
    label: "직장",
    emoji: "💼",
    situations: [
      {
        id: "meeting",
        label: "회의",
        roles: ["회의 진행", "회의록 작성", "자료 준비", "일정 조율"],
      },
      {
        id: "project",
        label: "프로젝트",
        roles: ["기획", "개발", "디자인", "QA"],
      },
    ],
  },
  {
    id: "home",
    label: "집",
    emoji: "🏠",
    situations: [
      {
        id: "chores",
        label: "집안일",
        roles: ["설거지", "청소", "쓰레기 버리기", "장보기"],
      },
      {
        id: "roommate",
        label: "룸메이트 생활",
        roles: ["공과금 관리", "장보기", "청소 당번", "분리수거"],
      },
    ],
  },
];

export function findSituation(
  situationId: string | null | undefined
): { category: SituationCategory; situation: Situation } | null {
  if (!situationId) return null;
  for (const category of SITUATION_CATEGORIES) {
    const situation = category.situations.find((s) => s.id === situationId);
    if (situation) return { category, situation };
  }
  return null;
}
