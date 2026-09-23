// src/lib/situations.ts — "상황" 카탈로그. 하드코딩된 페이지를 여러 개 만드는 대신
// 이 데이터 구조에 항목을 추가/수정하는 것만으로 상황을 늘릴 수 있게 한다.
// taskHint는 방 만들기 단계에서 입력창 placeholder로만 쓰이는 참고용 문구라, 실제
// task 값을 강제로 채우지는 않는다(기존 방 만들기 입력 로직은 그대로 유지).

export interface Situation {
  id: string;
  label: string;
  taskHint: string;
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
      { id: "team-project", label: "팀플", taskHint: "자료조사, PPT, 발표..." },
      { id: "presentation", label: "발표 준비", taskHint: "대본, 슬라이드, 리허설..." },
    ],
  },
  {
    id: "work",
    label: "직장",
    emoji: "💼",
    situations: [
      { id: "meeting", label: "회의", taskHint: "회의 진행, 회의록, 일정 관리..." },
      { id: "project", label: "프로젝트", taskHint: "기획, 개발, QA..." },
    ],
  },
  {
    id: "home",
    label: "집",
    emoji: "🏠",
    situations: [
      { id: "chores", label: "집안일", taskHint: "설거지, 청소, 쓰레기, 장보기..." },
      { id: "roommate", label: "룸메이트 생활", taskHint: "공과금, 장보기, 청소 당번..." },
    ],
  },
];
