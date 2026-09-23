"use client";
// 방 만들기 폼. createRoom 서버 액션은 성공 시 redirect()를 던지는데, 이건 정상적인
// 제어 흐름이라 여기서 절대 잡지 않는다(try/catch로 감싸면 리다이렉트가 먹통이 된다) —
// useActionState는 pending 표시만 위해 쓰고, 에러/리다이렉트는 그대로 흘려보낸다.
import { useActionState } from "react";
import { createRoom } from "@/app/actions";

export function CreateRoomForm({
  problemType,
  situation,
  taskPlaceholder,
}: {
  problemType?: string;
  situation?: string | null;
  taskPlaceholder?: string;
} = {}) {
  const [, formAction, pending] = useActionState(async (_prev: null, formData: FormData) => {
    await createRoom(formData);
    return null;
  }, null);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      {problemType && <input type="hidden" name="problem_type" value={problemType} />}
      {situation && <input type="hidden" name="situation" value={situation} />}
      <label htmlFor="task" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        무슨 일을 정할까요?
      </label>
      <input
        id="task"
        name="task"
        type="text"
        required
        maxLength={30}
        placeholder={taskPlaceholder ?? "설거지, 청소, 커피 사기..."}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50"
      />
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
