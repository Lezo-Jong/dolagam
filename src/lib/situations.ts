// src/lib/situations.ts — "상황" + 그 상황에서 나눠 맡을 "역할 풀" + "능력 카테고리"
// 카탈로그. 하드코딩된 페이지 대신 이 데이터 구조에 항목을 추가/수정하는 것만으로
// 상황·역할·능력을 늘릴 수 있다. 방장이 역할을 직접 편집하는 UI는 다음 단계 — 지금은
// 상황을 고르면 이 프리셋 role 목록이 그대로 방의 역할 풀이 된다.

export interface Situation {
  id: string;
  label: string;
  roles: string[];
  // 집안일처럼 매주/매번 반복해서 다시 정하는 상황인지. 결과 화면 문구("다시 하기" vs
  // "다음 주 당번 정하기")만 바꾸는 용도라 — 실제 배정 로직은 두 경우 다 똑같이 동작한다.
  recurring: boolean;
  // 이 상황에서 플레이어가 스스로 매기는 "능력/선호" 카테고리 추천 목록. 역할과 꼭
  // 1:1은 아니다(예: 팀플의 "글쓰기"처럼 지금 역할 풀엔 없어도 미리 준비해둘 수 있다).
  skills: string[];
  // 역할 이름 -> 관련 능력 카테고리. 충돌 카드/결과 화면에서 "이 역할과 관련된 능력"을
  // 보여줄 때 쓴다. 매핑이 없는 역할은 능력 표시를 생략한다.
  roleSkills: Record<string, string>;
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
        skills: ["발표", "디자인", "개발", "자료조사", "글쓰기"],
        roleSkills: {
          "발표": "발표",
          "자료조사": "자료조사",
          "PPT·디자인": "디자인",
          "개발·실습": "개발",
        },
      },
      {
        id: "presentation",
        label: "발표 준비",
        roles: ["대본 작성", "슬라이드 제작", "리허설 진행", "Q&A 준비"],
        recurring: false,
        skills: ["글쓰기", "디자인", "발표", "순발력"],
        roleSkills: {
          "대본 작성": "글쓰기",
          "슬라이드 제작": "디자인",
          "리허설 진행": "발표",
          "Q&A 준비": "순발력",
        },
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
        skills: ["진행력", "글쓰기", "자료조사", "기획"],
        roleSkills: {
          "회의 진행": "진행력",
          "회의록 작성": "글쓰기",
          "자료 준비": "자료조사",
          "일정 조율": "기획",
        },
      },
      {
        id: "project",
        label: "프로젝트",
        roles: ["기획", "개발", "디자인", "QA"],
        recurring: false,
        skills: ["기획", "개발", "디자인", "꼼꼼함"],
        roleSkills: {
          "기획": "기획",
          "개발": "개발",
          "디자인": "디자인",
          "QA": "꼼꼼함",
        },
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
        skills: ["요리", "청소", "정리", "장보기", "설거지"],
        roleSkills: {
          "설거지": "설거지",
          "청소": "청소",
          "쓰레기 버리기": "정리",
          "장보기": "장보기",
        },
      },
      {
        id: "roommate",
        label: "룸메이트 생활",
        roles: ["공과금 관리", "장보기", "청소 당번", "분리수거"],
        recurring: true,
        skills: ["정리", "장보기", "청소", "꼼꼼함"],
        roleSkills: {
          "공과금 관리": "꼼꼼함",
          "장보기": "장보기",
          "청소 당번": "청소",
          "분리수거": "정리",
        },
      },
    ],
  },
];

// 🛍️ 뭘 살까(problem_type='budget')는 "역할 정하기"와 완전히 같은 엔진을 쓴다 — 물건도
// "역할"처럼 한 사람에게 배정되는 것뿐이다(담당자 배정). 그래서 새 게임 로직을 만들지
// 않고 이 Situation 카탈로그에 하나만 더 얹는다. 다만 대학/직장/집 상황 목록(사람이
// "역할 정하기"를 고를 때 고르는 목록)에는 안 섞이게 SITUATION_CATEGORIES엔 안 넣고
// findSituation에서만 별도로 찾는다.
const SHOPPING_SITUATION: { category: SituationCategory; situation: Situation } = {
  category: { id: "shopping", label: "쇼핑", emoji: "🛍️", situations: [] },
  situation: {
    id: "shopping-default",
    label: "생필품 사기",
    roles: ["🧻 휴지", "🧴 세제", "🍜 라면", "🥤 음료", "🍪 간식"],
    recurring: false,
    skills: [],
    roleSkills: {},
  },
};

export function findSituation(
  situationId: string | null | undefined
): { category: SituationCategory; situation: Situation } | null {
  if (!situationId) return null;
  for (const category of SITUATION_CATEGORIES) {
    const situation = category.situations.find((s) => s.id === situationId);
    if (situation) return { category, situation };
  }
  if (situationId === SHOPPING_SITUATION.situation.id) return SHOPPING_SITUATION;
  return null;
}
