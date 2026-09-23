"use client";
// 홈 화면 위저드: 문제 유형 선택 → 상황 선택 → (기존) 방 만들기.
// 세 단계 모두 이 컴포넌트 안의 로컬 state로만 관리한다(새 라우트/서버 상태 없음) —
// 방이 실제로 생기는 시점은 마지막 단계에서 기존 CreateRoomForm이 createRoom 액션을
// 호출할 때뿐이라, 앞 두 단계는 그냥 "어떤 값을 hidden input으로 들려 보낼지" 고르는
// 과정에 지나지 않는다.
import { useState } from "react";
import { CreateRoomForm } from "@/components/CreateRoomForm";
import { PROBLEM_TYPES, type ProblemTypeId } from "@/lib/problemTypes";
import { SITUATION_CATEGORIES } from "@/lib/situations";

type Step = "problem" | "situation" | "create";

export function NewRoomWizard() {
  const [step, setStep] = useState<Step>("problem");
  const [problemType, setProblemType] = useState<ProblemTypeId | null>(null);
  const [situationId, setSituationId] = useState<string | null>(null);
  const [situationLabel, setSituationLabel] = useState<string | null>(null);
  const [taskHint, setTaskHint] = useState<string | undefined>(undefined);

  if (step === "problem") {
    return (
      <>
        <div className="flex flex-col gap-1 text-center">
          <span className="text-sm font-medium text-zinc-400">돌아가면요</span>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            오늘 해결하기 어려운 일이 있나요?
          </h1>
        </div>

        <div className="flex flex-col gap-2">
          {PROBLEM_TYPES.map((pt) => (
            <button
              key={pt.id}
              type="button"
              disabled={!pt.enabled}
              onClick={() => {
                setProblemType(pt.id);
                setStep("situation");
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-50 dark:disabled:hover:border-zinc-800"
            >
              <span className="text-2xl">{pt.emoji}</span>
              <span className="flex-1">
                <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {pt.label}
                </span>
                <span className="block text-sm text-zinc-500 dark:text-zinc-400">{pt.description}</span>
              </span>
              {!pt.enabled && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">
                  준비 중
                </span>
              )}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (step === "situation") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setStep("problem")}
            className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← 이전
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            어떤 상황인가요?
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">가장 가까운 상황을 골라주세요</p>
        </div>

        <div className="flex flex-col gap-4">
          {SITUATION_CATEGORIES.map((category) => (
            <div key={category.id} className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-zinc-500">
                {category.emoji} {category.label}
              </span>
              <div className="flex flex-wrap gap-2">
                {category.situations.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSituationId(s.id);
                      setSituationLabel(`${category.label} · ${s.label}`);
                      setTaskHint(s.taskHint);
                      setStep("create");
                    }}
                    className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-50 dark:hover:text-zinc-50"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setStep("situation")}
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← 이전
        </button>
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            돌아가면요
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">누가 할지, 공평하게 뽑아요.</p>
          {situationLabel && <p className="text-sm text-zinc-400">{situationLabel}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <CreateRoomForm
          problemType={problemType ?? undefined}
          situation={situationId}
          taskPlaceholder={taskHint}
        />
      </div>

      <p className="text-center text-sm leading-6 text-zinc-500 dark:text-zinc-500">
        로그인 없이 링크로 바로 참여해요.
        <br />
        오래 안 뽑힐수록 다음에 뽑힐 확률이 올라가요.
      </p>
    </>
  );
}
