"use client";
// 방(room) 화면. 초기 데이터는 서버 컴포넌트에서 props로 받고, 이후 변경 사항은 전부
// Supabase Realtime 구독으로 반영한다 — 내가 한 액션(추가/삭제/뽑기)도 서버 왕복 후
// 이 채널을 통해 되돌아오므로, 액션 성공 시 로컬 state를 직접 조작할 필요가 없다.
// 예외는 뽑기 결과 배너뿐인데, drawWinner()가 당첨자 이름을 즉시 반환해주기 때문이다.
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useActionState } from "react";
import { addMember, drawWinner, removeMember, updateTask } from "@/app/actions";
import { getSupabase } from "@/lib/supabase";
import { weightOf, type Draw, type Member, type Room } from "@/lib/types";

const SPIN_MS = 900;

export function RoomView({
  initialRoom,
  initialMembers,
  initialDraws,
}: {
  initialRoom: Room;
  initialMembers: Member[];
  initialDraws: Draw[];
}) {
  const [supabase] = useState(() => getSupabase());
  const [room, setRoom] = useState(initialRoom);
  const [members, setMembers] = useState(initialMembers);
  const [draws, setDraws] = useState(initialDraws);

  const [copied, setCopied] = useState(false);

  const [editingTask, setEditingTask] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [spinName, setSpinName] = useState<string | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [lastWinner, setLastWinner] = useState<string | null>(null);
  const spinTimer = useRef<number | null>(null);

  // 서버에는 window가 없어 SSR 시점엔 빈 문자열을 내려주고, 하이드레이션 이후 실제
  // origin으로 채운다 — 값이 바뀔 일이 없으니 subscribe는 아무것도 하지 않는다.
  const shareUrl = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}/r/${room.slug}`,
    () => ""
  );

  useEffect(() => {
    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setRoom(payload.new as Room);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setMembers((current) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Member;
              if (current.some((m) => m.id === next.id)) return current;
              return [...current, next].sort((a, b) => a.created_at.localeCompare(b.created_at));
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Member;
              return current.map((m) => (m.id === next.id ? next : m));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as Partial<Member>;
              return current.filter((m) => m.id !== old.id);
            }
            return current;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "draws", filter: `room_id=eq.${room.id}` },
        (payload) => {
          const next = payload.new as Draw;
          setDraws((current) => [next, ...current].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    return () => {
      if (spinTimer.current) window.clearInterval(spinTimer.current);
    };
  }, []);

  const [, saveTaskAction, savingTask] = useActionState(async (_prev: null, formData: FormData) => {
    const task = String(formData.get("task") ?? "").trim();
    await updateTask(room.id, task);
    setEditingTask(false);
    return null;
  }, null);

  const [addState, addAction, addPending] = useActionState(
    async (prev: { error: string | null; key: number }, formData: FormData) => {
      const name = String(formData.get("name") ?? "");
      const result = await addMember(room.id, name);
      if (!result.ok) return { error: result.error, key: prev.key };
      return { error: null, key: prev.key + 1 };
    },
    { error: null, key: 0 }
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 접근이 막혀 있으면 조용히 무시 — 링크는 화면에 그대로 보인다.
    }
  }

  async function handleDraw() {
    if (members.length < 2 || isDrawing) return;
    setDrawError(null);
    setLastWinner(null);
    setIsDrawing(true);

    const pool = members;
    spinTimer.current = window.setInterval(() => {
      setSpinName(pool[Math.floor(Math.random() * pool.length)].name);
    }, 80);

    const [result] = await Promise.all([
      drawWinner(room.id),
      new Promise((resolve) => setTimeout(resolve, SPIN_MS)),
    ]);

    if (spinTimer.current) {
      window.clearInterval(spinTimer.current);
      spinTimer.current = null;
    }
    setSpinName(null);
    setIsDrawing(false);

    if (!result.ok) {
      setDrawError(result.error);
      return;
    }
    setLastWinner(result.winnerName);
  }

  const totalWeight = members.reduce((sum, m) => sum + weightOf(m, room.round), 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 새 방
          </Link>
          <span>지금까지 {room.round}번 뽑았어요</span>
        </div>

        {editingTask ? (
          <form action={saveTaskAction} className="flex gap-2">
            <input
              name="task"
              defaultValue={room.task}
              maxLength={30}
              autoFocus
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xl font-bold text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50"
            />
            <button
              type="submit"
              disabled={savingTask}
              className="rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              저장
            </button>
          </form>
        ) : (
          <button
            onClick={() => setEditingTask(true)}
            className="flex items-baseline gap-2 text-left"
          >
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {room.task || "할 일 없음"}
            </h1>
            <span className="text-sm text-zinc-400">수정</span>
          </button>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400">{shareUrl}</span>
          <button
            onClick={handleCopy}
            className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50"
          >
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
      </header>

      <section className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={handleDraw}
          disabled={members.length < 2 || isDrawing}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-zinc-900 text-xl font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isDrawing ? spinName ?? "뽑는 중..." : "뽑기!"}
        </button>
        {members.length < 2 && (
          <p className="text-sm text-zinc-500">참가자가 2명 이상이어야 뽑을 수 있어요</p>
        )}
        {drawError && <p className="text-sm text-red-500">{drawError}</p>}
        {lastWinner && !isDrawing && (
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">🎉 {lastWinner}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-500">참가자 {members.length}명</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              probability={totalWeight > 0 ? (weightOf(member, room.round) / totalWeight) * 100 : 0}
            />
          ))}
        </ul>

        <form action={addAction} className="flex gap-2">
          <div key={addState.key} className="flex-1">
            <input
              name="name"
              placeholder="이름"
              maxLength={12}
              required
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50"
            />
          </div>
          <button
            type="submit"
            disabled={addPending}
            className="shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
          >
            추가
          </button>
        </form>
        {addState.error && <p className="text-sm text-red-500">{addState.error}</p>}
      </section>

      {draws.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-500">최근 기록</h2>
          <ul className="flex flex-col gap-1.5">
            {draws.map((draw) => (
              <li
                key={draw.id}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {draw.member_name}
                </span>
                <span>{draw.round}회차 · {draw.task || "할 일 없음"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MemberRow({ member, probability }: { member: Member; probability: number }) {
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      await removeMember(member.id);
    });
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{member.name}</span>
          <span className="text-zinc-400">{probability.toFixed(0)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-900 dark:bg-zinc-50"
            style={{ width: `${probability}%` }}
          />
        </div>
      </div>
      <button
        onClick={handleRemove}
        disabled={isPending}
        aria-label={`${member.name} 삭제`}
        className="shrink-0 text-zinc-400 hover:text-red-500 disabled:opacity-40"
      >
        ✕
      </button>
    </li>
  );
}
