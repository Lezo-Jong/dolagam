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
      // 이미 "나"로 정해진 사람이 있으면(=혼자 여러 명을 등록해서 시연하는 경우) 새로
      // 추가한 사람으로 내 정체성을 바꾸지 않는다 — 처음 참가할 때만 자동으로 "나"가 된다.
      if (!myMemberId) {
        setMyMemberId(room.id, result.memberId);
        setJoinedMemberId(result.memberId);
      }
      setJoinName("");
    });
  }

  function handleBecome(memberId: string) {
    setMyMemberId(room.id, memberId);
    setJoinedMemberId(memberId);
  }

  function handleStart() {
    setStartError(null);
    startStarting(async () => {
      const result = await startGame(room.id);
      if (!result.ok) setStartError(result.error);
    });
  }

  function handlePickRank(rank: number, roleLabel: string | null) {
    if (!myMemberId) return;
    submitPreference(room.id, myMemberId, rank, roleLabel);
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

  const maxRank = Math.min(3, roles.length);
  const myRanks = new Map<number, string>();
  for (const p of preferences) if (p.member_id === myMemberId) myRanks.set(p.rank, p.role_label);

  // 1지망 신청 현황만 보여준다 — 충돌이 생길지 미리 짐작할 수 있게 하는 용도라
  // 2·3지망까지 다 합쳐서 보여주면 오히려 헷갈린다.
  const tally1 = new Map<string, number>();
  for (const role of roles) tally1.set(role, 0);
  for (const p of preferences) if (p.rank === 1) tally1.set(p.role_label, (tally1.get(p.role_label) ?? 0) + 1);

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

      <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {me ? "참가자 추가" : "참가하려면 이름을 알려주세요"}
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
            {me ? "추가" : "참가"}
          </button>
        </div>
        {joinError && <p className="text-sm text-red-500">{joinError}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-500">참가자 {members.length}명</h2>
        {members.length > 1 && (
          <p className="text-xs text-zinc-400">
            이름을 탭하면 그 사람이 돼서 지망을 고를 수 있어요 — 혼자 시연할 때 유용해요.
          </p>
        )}
        <ul className="flex flex-wrap gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => handleBecome(member.id)}
                className={
                  member.id === myMemberId
                    ? "font-semibold text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }
              >
                {member.name}
                {member.id === myMemberId && <span className="text-zinc-400"> (나)</span>}
              </button>
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
            {me ? `원하는 순서대로 최대 ${maxRank}개까지 골라주세요` : "역할"}
          </h2>

          {me ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: maxRank }, (_, i) => i + 1).map((rank) => {
                const chosen = myRanks.get(rank) ?? "";
                const availableRoles = roles.filter((role) => {
                  for (const [otherRank, otherRole] of myRanks) {
                    if (otherRank !== rank && otherRole === role) return false;
                  }
                  return true;
                });
                return (
                  <div key={rank} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-sm font-medium text-zinc-500">{rank}지망</span>
                    <select
                      value={chosen}
                      onChange={(e) => handlePickRank(rank, e.target.value || null)}
                      className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50"
                    >
                      <option value="">선택 안 함</option>
                      {availableRoles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">참가하면 지망을 선택할 수 있어요</p>
          )}

          <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-xs font-semibold text-zinc-400">1지망 신청 현황</span>
            {roles.map((role) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-zinc-700 dark:text-zinc-300">{role}</span>
                <span className="text-zinc-400">{tally1.get(role) ?? 0}명</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleResolve}
            disabled={resolving}
            className="mt-2 h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {resolving ? "결정하는 중..." : "결과 확정하기"}
          </button>
          <p className="text-center text-sm text-zinc-500">
            지망이 겹치면 그 사람들끼리만 뽑기로 정하고, 진 사람은 다음 지망으로 다시 시도해요.
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
                  <span className="text-xs text-zinc-400">{rankBadge(a.assigned_rank)}</span>
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

function rankBadge(assignedRank: number | null): string {
  if (assignedRank === 1) return "🎉 1지망";
  if (assignedRank === 2) return "👍 2지망";
  if (assignedRank === 3) return "😅 3지망";
  return "💤 비선호 역할";
}
