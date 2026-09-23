"use client";
// 역할 게임 화면. lobby(참가자 모으기) -> preference(1지망 선택) -> result(결과) 순서로
// 진행되고, 전부 이 컴포넌트 하나가 room.game_phase를 보고 갈아 끼운다(새 라우트 없음).
// 데이터 흐름은 기존 RoomView와 같은 원칙: 초기값은 서버 컴포넌트가 props로 주고,
// 이후 변경은 Supabase Realtime 구독으로만 반영한다 — 내가 한 액션도 서버 왕복 후
// 이 채널로 돌아오므로 성공 시 로컬 state를 직접 조작할 필요가 없다.
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  addMember,
  removeMember,
  resolveRoles,
  restartRound,
  startGame,
  submitPreference,
} from "@/app/actions";
import { getMyMemberId, setMyMemberId } from "@/lib/identity";
import { getSupabase } from "@/lib/supabase";
import type { Member, Room, RoleAssignment, RolePreference } from "@/lib/types";

export function RoleGameView({
  initialRoom,
  initialMembers,
  initialPreferences,
  initialAssignments,
  roles,
  situationLabel,
}: {
  initialRoom: Room;
  initialMembers: Member[];
  initialPreferences: RolePreference[];
  initialAssignments: RoleAssignment[];
  roles: string[];
  situationLabel: string;
}) {
  const [supabase] = useState(() => getSupabase());
  const [room, setRoom] = useState(initialRoom);
  const [members, setMembers] = useState(initialMembers);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [assignments, setAssignments] = useState(initialAssignments);

  const storedMemberId = useSyncExternalStore(
    () => () => {},
    () => getMyMemberId(room.id),
    () => null
  );
  const [joinedMemberId, setJoinedMemberId] = useState<string | null>(null);
  const myMemberId = joinedMemberId ?? storedMemberId;
  const me = members.find((m) => m.id === myMemberId) ?? null;

  const shareUrl = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}/r/${room.slug}`,
    () => ""
  );
  const [copied, setCopied] = useState(false);

  const [joinName, setJoinName] = useState("");
  const [joinPending, startJoin] = useTransition();
  const [joinError, setJoinError] = useState<string | null>(null);

  const [starting, startStarting] = useTransition();
  const [startError, setStartError] = useState<string | null>(null);

  const [resolving, startResolving] = useTransition();
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [restarting, startRestarting] = useTransition();

  useEffect(() => {
    const channel = supabase
      .channel(`role-game-${room.id}`)
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
        { event: "*", schema: "public", table: "role_preferences", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setPreferences((current) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as Partial<RolePreference>;
              return current.filter((p) => p.id !== old.id);
            }
            const next = payload.new as RolePreference;
            const withoutOld = current.filter(
              (p) => !(p.member_id === next.member_id && p.rank === next.rank)
            );
            return [...withoutOld, next];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_assignments", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setAssignments([]);
            return;
          }
          const next = payload.new as RoleAssignment;
          setAssignments((current) => {
            if (current.some((a) => a.id === next.id)) return current;
            return [...current, next];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  function handleCopy() {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // 클립보드 접근이 막혀 있으면 조용히 무시 — 링크는 화면에 그대로 보인다.
      });
  }

  function handleJoin() {
    const name = joinName.trim();
    if (!name) return;
    setJoinError(null);
    startJoin(async () => {
      const result = await addMember(room.id, name);
      if (!result.ok) {
        setJoinError(result.error);
        return;
      }
      setMyMemberId(room.id, result.memberId);
      setJoinedMemberId(result.memberId);
      setJoinName("");
    });
  }

  function handleStart() {
    setStartError(null);
    startStarting(async () => {
      const result = await startGame(room.id);
      if (!result.ok) setStartError(result.error);
    });
  }

  function handlePick(roleLabel: string) {
    if (!myMemberId) return;
    submitPreference(room.id, myMemberId, roleLabel);
  }

  function handleResolve() {
    setResolveError(null);
    startResolving(async () => {
      const result = await resolveRoles(room.id);
      if (!result.ok) setResolveError(result.error);
    });
  }

  function handleRestart() {
    startRestarting(async () => {
      await restartRound(room.id);
    });
  }

  const myPreference = preferences.find((p) => p.member_id === myMemberId)?.role_label ?? null;
  const tally = new Map<string, number>();
  for (const role of roles) tally.set(role, 0);
  for (const p of preferences) tally.set(p.role_label, (tally.get(p.role_label) ?? 0) + 1);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 새 방
          </Link>
          <span>지금까지 {room.round}번 진행했어요</span>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{room.task}</h1>
          <p className="text-sm text-zinc-400">{situationLabel}</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400">{shareUrl}</span>
          <button onClick={handleCopy} className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
      </header>

      {!me && (
        <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            참가하려면 이름을 알려주세요
          </label>
          <div className="flex gap-2">
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="이름"
              maxLength={12}
              className="w-full flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50"
            />
            <button
              onClick={handleJoin}
              disabled={joinPending}
              className="shrink-0 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
            >
              참가
            </button>
          </div>
          {joinError && <p className="text-sm text-red-500">{joinError}</p>}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-500">참가자 {members.length}명</h2>
        <ul className="flex flex-wrap gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-zinc-900 dark:text-zinc-50">
                {member.name}
                {member.id === myMemberId && <span className="text-zinc-400"> (나)</span>}
              </span>
              <button
                onClick={() => removeMember(member.id)}
                aria-label={`${member.name} 삭제`}
                className="text-zinc-300 hover:text-red-500"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {room.game_phase === "lobby" && (
        <section className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">역할: {roles.join(" · ")}</p>
          <button
            onClick={handleStart}
            disabled={members.length < 2 || starting}
            className="mt-2 h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            게임 시작
          </button>
          {members.length < 2 && (
            <p className="text-sm text-zinc-500">참가자가 2명 이상이어야 시작할 수 있어요</p>
          )}
          {startError && <p className="text-sm text-red-500">{startError}</p>}
        </section>
      )}

      {room.game_phase === "preference" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-500">
            {me ? "가장 원하는 역할을 골라주세요 (1지망)" : "역할"}
          </h2>
          <div className="flex flex-col gap-2">
            {roles.map((role) => {
              const count = tally.get(role) ?? 0;
              const selected = myPreference === role;
              return (
                <button
                  key={role}
                  type="button"
                  disabled={!me}
                  onClick={() => handlePick(role)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                    selected
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  <span className="font-medium">{role}</span>
                  <span className={selected ? "text-white/70 dark:text-zinc-900/60" : "text-zinc-400"}>
                    {count}명 지원
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={handleResolve}
            disabled={resolving}
            className="mt-2 h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {resolving ? "결정하는 중..." : "결과 확정하기"}
          </button>
          <p className="text-center text-sm text-zinc-500">
            같은 역할에 2명 이상 지원하면 그 사람들끼리만 뽑기로 정해요.
          </p>
          {resolveError && <p className="text-center text-sm text-red-500">{resolveError}</p>}
        </section>
      )}

      {room.game_phase === "result" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-500">결과</h2>
          <ul className="flex flex-col gap-2">
            {assignments
              .filter((a) => a.round === room.round)
              .map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {a.member_name} → {a.role_label}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {a.resolved_by === "draw" ? "🎲 뽑기로 결정" : "✅ 선택대로"}
                  </span>
                </li>
              ))}
          </ul>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="mt-2 h-11 w-full rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50"
          >
            다시 정하기
          </button>
        </section>
      )}
    </div>
  );
}
