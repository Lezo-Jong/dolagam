// src/lib/situations.ts — "상황" + 그 상황에서 나눠 맡을 "역할 풀" 카탈로그.
// 하드코딩된 페이지 대신 이 데이터 구조에 항목을 추가/수정하는 것만으로 상황과 역할을
// 늘릴 수 있다. 방장이 역할을 직접 편집하는 UI는 다음 단계 — 지금은 상황을 고르면
// 이 프리셋 role 목록이 그대로 방의 역할 풀이 된다.

export interface Situation {
  id: string;
  label: string;
  roles: string[];
  // 집안일처럼 매주/매번 반복해서 다시 정하는 상황인지. 결과 화면 문구("다시 하기" vs
  // "다음 주 당번 정하기")만 바꾸는 용도라 — 실제 배정 로직은 두 경우 다 똑같이 동작한다.
  recurring: boolean;
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
        recurring: false,
      },
      {
        id: "presentation",
        label: "발표 준비",
        roles: ["대본 작성", "슬라이드 제작", "리허설 진행", "Q&A 준비"],
        recurring: false,
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
        recurring: false,
      },
      {
        id: "project",
        label: "프로젝트",
        roles: ["기획", "개발", "디자인", "QA"],
        recurring: false,
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
        recurring: true,
      },
      {
        id: "roommate",
        label: "룸메이트 생활",
        roles: ["공과금 관리", "장보기", "청소 당번", "분리수거"],
        recurring: true,
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
