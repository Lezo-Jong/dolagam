"use client";
// 🔀 주제 바꾸기 — "다시 하기"와 다른 별도 기능이다(같은 방/참가자를 유지한 채
// problem_type/situation만 바꿔서 다른 생활 문제로 넘어간다). 결과 화면(game_phase
// ==='result')에서만 노출된다. 이 프로젝트엔 원래 "방장" 개념이 없고 누구나 "다시
// 하기"를 누를 수 있게 돼 있어서, 이 기능도 새 권한 체계를 만들지 않고 같은 규칙
// (참가자 누구나)을 그대로 따른다.
import { useState, useTransition } from "react";
import { changeTopic } from "@/app/actions";
import { PROBLEM_TYPES } from "@/lib/problemTypes";
import { SITUATION_CATEGORIES } from "@/lib/situations";
import { DIRECT_TOPIC_PRESETS } from "@/lib/topicCatalog";

export function TopicSwitcher({
  roomId,
  currentProblemType,
  onCancel,
}: {
  roomId: string;
  currentProblemType: string;
  onCancel: () => void;
}) {
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickingSituation, setPickingSituation] = useState(false);

  function confirm(problemType: string, situationId: string) {
    setError(null);
    startPending(async () => {
      const result = await changeTopic(roomId, problemType, situationId);
      if (!result.ok) setError(result.error);
    });
  }

  function handlePick(problemType: string) {
    if (problemType === currentProblemType) return;
    if (problemType === "role_assignment") {
      setPickingSituation(true);
      return;
    }
    const preset = DIRECT_TOPIC_PRESETS[problemType];
    if (preset) confirm(problemType, preset.situationId);
  }

  if (pickingSituation) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setPickingSituation(false)}
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← 이전
        </button>
        <h3 className="text-sm font-semibold text-zinc-500">어떤 상황인가요?</h3>
        {SITUATION_CATEGORIES.map((category) => (
          <div key={category.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">
              {category.emoji} {category.label}
            </span>
            <div className="flex flex-wrap gap-2">
              {category.situations.map((s) => (
                <button
                  key={s.id}
                  onClick={() => confirm("role_assignment", s.id)}
                  disabled={pending}
                  className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-500">🔀 어떤 게임을 할까요?</h3>
        <button onClick={onCancel} className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300">
          취소
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {PROBLEM_TYPES.map((pt) => {
          const isCurrent = pt.id === currentProblemType;
          return (
            <button
              key={pt.id}
              onClick={() => handlePick(pt.id)}
              disabled={isCurrent || pending}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-left transition-colors hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:border-zinc-50"
            >
              <span className="text-xl">{pt.emoji}</span>
              <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">{pt.label}</span>
              {isCurrent && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">
                  현재 주제
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {pending && <p className="text-sm text-zinc-400">바꾸는 중...</p>}
    </div>
  );
}
