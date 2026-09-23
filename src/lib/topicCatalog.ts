// src/lib/topicCatalog.ts — "🔀 주제 바꾸기"에서 쓰는, problem_type별 기본 상황/후보
// 카탈로그. NewRoomWizard의 최초 방 생성 흐름과 같은 프리셋 데이터를 공유한다 —
// 팀 역할 정하기만 여러 상황(대학/직장/집) 중에 고르고, 나머지 넷은 프리셋이 하나뿐이라
// 바로 확정된다.
import { DECISION_PRESETS } from "./decisionPresets";
import { SHOPPING_SITUATION } from "./situations";

export interface DirectTopicPreset {
  problemType: string;
  situationId: string;
}

export const DIRECT_TOPIC_PRESETS: Record<string, DirectTopicPreset> = {
  budget: { problemType: "budget", situationId: SHOPPING_SITUATION.situation.id },
  ...Object.fromEntries(
    DECISION_PRESETS.map((p) => [p.problemType, { problemType: p.problemType, situationId: p.id }])
  ),
};
