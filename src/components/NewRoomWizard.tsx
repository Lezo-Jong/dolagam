"use client";
// 홈 화면 위저드: 문제 유형 선택 → 상황 선택 → 방 만들기.
// 세 단계 모두 이 컴포넌트 안의 로컬 state로만 관리한다(새 라우트/서버 상태 없음) —
// 방이 실제로 생기는 시점은 마지막 단계에서 createRoom 액션을 호출할 때뿐이라, 앞 두
// 단계는 그냥 "어떤 값을 hidden input으로 들려 보낼지" 고르는 과정에 지나지 않는다.
//
// 마지막 단계는 상황을 고르면 정해지는 역할 풀(situations.ts)을 그대로 보여주고
// 확인만 받는다 — 자유 텍스트로 "무슨 일을 정할까요?"를 다시 묻지 않는다. 그 질문은
// 역할이 여러 개로 나뉘는 이 흐름과 맞지 않기 때문이다(CreateRoomForm은 자유 텍스트
// task가 필요할 미래의 다른 문제 유형을 위해 그대로 남겨둔다).
import { useActionState, useState } from "react";
import { createRoom } from "@/app/actions";
import { DECISION_PRESETS } from "@/lib/decisionPresets";
import { PROBLEM_TYPES, type ProblemTypeId } from "@/lib/problemTypes";
import { SITUATION_CATEGORIES } from "@/lib/situations";

type Step = "problem" | "situation" | "create";

// 팀 역할 정하기만 "상황"을 골라야 역할 풀이 정해진다(대학/직장/집 카테고리 브라우징).
// 나머지 네 가지는 문제 유형 하나당 미리 정해둔 후보 세트가 하나뿐이라 상황 선택
// 단계를 건너뛰고 바로 확인 화면으로 간다. 🛍️ 뭘 살까(budget)는 situations.ts의
// SHOPPING_SITUATION을 그대로 쓴다 — "역할 정하기"와 완전히 같은 엔진이기 때문이다.
const SHOPPING_PRESET = {
  situationId: "shopping-default",
  label: "🛍️ 쇼핑 · 생필품 사기",
  name: "생필품 사기",
  candidates: ["🧻 휴지", "🧴 세제", "🍜 라면", "🥤 음료", "🍪 간식"],
  subtitle: "같이 필요한 물건을 정해보세요.",
};

const DIRECT_PRESETS: Record<
  string,
  { situationId: string; label: string; name: string; candidates: string[]; subtitle: string }
> = {
  budget: SHOPPING_PRESET,
  ...Object.fromEntries(
    DECISION_PRESETS.map((p) => [
      p.problemType,
      {
        situationId: p.id,
        label: p.label,
        name: p.label,
        candidates: p.candidates,
        subtitle:
          p.mode === "single-choice"
            ? "다 같이 하나로 정해보세요."
            : "해야 할 일의 순서를 정해보세요.",
      },
    ])
  ),
};

export function NewRoomWizard() {
  const [step, setStep] = useState<Step>("problem");
  const [problemType, setProblemType] = useState<ProblemTypeId | null>(null);
  const [situationId, setSituationId] = useState<string | null>(null);
  const [situationLabel, setSituationLabel] = useState<string | null>(null);
  const [situationName, setSituationName] = useState<string>("");
  const [situationRoles, setSituationRoles] = useState<string[]>([]);
  const [subtitle, setSubtitle] = useState<string>("이 역할들을 나눠 맡아요.");

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
                const preset = DIRECT_PRESETS[pt.id];
                if (preset) {
                  setSituationId(preset.situationId);
                  setSituationLabel(preset.label);
                  setSituationName(preset.name);
                  setSituationRoles(preset.candidates);
                  setSubtitle(preset.subtitle);
                  setStep("create");
                } else {
                  setStep("situation");
                }
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
                      setSituationName(s.label);
                      setSituationRoles(s.roles);
                      setSubtitle("이 역할들을 나눠 맡아요.");
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
          onClick={() => setStep(problemType && DIRECT_PRESETS[problemType] ? "problem" : "situation")}
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← 이전
        </button>
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            돌아가면요
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">{subtitle}</p>
          {situationLabel && <p className="text-sm text-zinc-400">{situationLabel}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-2">
          {situationRoles.map((role) => (
            <span
              key={role}
              className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {role}
            </span>
          ))}
        </div>
        <div className="mt-4">
          <ConfirmCreateRoomForm
            problemType={problemType ?? "role_assignment"}
            situation={situationId ?? ""}
            task={situationName}
          />
        </div>
      </div>

      <p className="text-center text-sm leading-6 text-zinc-500 dark:text-zinc-500">
        로그인 없이 링크로 바로 참여해요.
        <br />
        같은 역할에 몰리면 그 사람들끼리만 공정하게 뽑아요.
      </p>
    </>
  );
}

function ConfirmCreateRoomForm({
  problemType,
  situation,
  task,
}: {
  problemType: string;
  situation: string;
  task: string;
}) {
  const [, formAction, pending] = useActionState(async (_prev: null, formData: FormData) => {
    await createRoom(formData);
    return null;
  }, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="problem_type" value={problemType} />
      <input type="hidden" name="situation" value={situation} />
      <input type="hidden" name="task" value={task} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "만드는 중..." : "방 만들기"}
      </button>
    </form>
  );
}
