"use client";
// 🍚 뭘 먹을까 / 📋 뭐부터 할까 / 🕐 언제 만날까 화면. RoleGameView와 데이터 흐름
// 원칙은 같다(초기값은 서버 컴포넌트 props, 이후 변경은 Realtime 구독만) — 다만
// 결과가 "사람마다 다른 역할"이 아니라 "그룹 전체가 하나의 답"(single-choice) 또는
// "할 일들의 순서"(ordering)라서 결과/충돌 카드 표현만 다르게 렌더링한다. 선택/충돌
// 해결 자체(1~3지망 선택, 우선권/양보/승부/카드, 가위바위보)는 actions.ts의 같은
// 함수(submitPreference/submitConflictChoice/submitRpsMove)를 그대로 쓴다.
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addCustomRole,
  addMember,
  deleteCustomRole,
  removeMember,
  resolveDecision,
  restartRound,
  startDecisionGame,
  submitConflictChoice,
  submitPreference,
  submitRpsMove,
} from "@/app/actions";
import type { DecisionMode } from "@/lib/decisionPresets";
import { problemTypeLabel, summarizeRound } from "@/lib/gameHistory";
import { clearMyMemberId, getMyMemberId, setMyMemberId } from "@/lib/identity";
import { getSupabase } from "@/lib/supabase";
import type {
  ConflictChoice,
  CustomRole,
  Member,
  Room,
  RoleAssignment,
  RoleConflict,
  RoleConflictChoice,
  RolePreference,
  RpsMove,
} from "@/lib/types";
import { TopicSwitcher } from "@/components/TopicSwitcher";

export function DecisionGameView({
  initialRoom,
  initialMembers,
  initialPreferences,
  initialAssignments,
  initialConflicts,
  initialConflictChoices,
  initialCustomCandidates,
  defaultCandidates,
  mode,
  label,
  resultTitle,
  situationLabel,
}: {
  initialRoom: Room;
  initialMembers: Member[];
  initialPreferences: RolePreference[];
  initialAssignments: RoleAssignment[];
  initialConflicts: RoleConflict[];
  initialConflictChoices: RoleConflictChoice[];
  initialCustomCandidates: CustomRole[];
  defaultCandidates: string[];
  mode: DecisionMode;
  label: string;
  resultTitle: string;
  situationLabel: string;
}) {
  const router = useRouter();
  const [supabase] = useState(() => getSupabase());
  const [room, setRoom] = useState(initialRoom);
  const [members, setMembers] = useState(initialMembers);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [conflictChoices, setConflictChoices] = useState(initialConflictChoices);
  const [customCandidates, setCustomCandidates] = useState(initialCustomCandidates);

  // 방장이 미리 골라둔 후보 세트 이름들(추천 후보 이름 그대로 + 커스텀 후보는 id로) —
  // RoleGameView의 selectedRoles와 같은 이유로 커스텀 항목은 id로 저장한다(이름이
  // 바뀌어도 선택 상태가 안 어긋나게).
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>(() => {
    if (initialRoom.active_roles && initialRoom.active_roles.length > 0) {
      return initialRoom.active_roles.map((name) => {
        const custom = initialCustomCandidates.find((c) => c.name === name);
        return custom ? custom.id : name;
      });
    }
    return [...defaultCandidates, ...initialCustomCandidates.map((c) => c.id)];
  });
  const selectedCandidateNames = selectedCandidates.map(
    (entry) => customCandidates.find((c) => c.id === entry)?.name ?? entry
  );

  const [view, setView] = useState<"game" | "history">("game");
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [newCandidateName, setNewCandidateName] = useState("");
  const [candidateError, setCandidateError] = useState<string | null>(null);

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
  const [candidatePending, startCandidateAction] = useTransition();

  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const viewingResult = dismissedRound !== room.round;

  const [showTopicSwitcher, setShowTopicSwitcher] = useState(false);

  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    const channel = supabase
      .channel(`decision-game-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const next = payload.new as Room;
          // 🔀 주제 바꾸기로 problem_type/situation이 바뀌면 page.tsx가 다시 실행돼야
          // 맞는 화면(RoleGameView일 수도 있음)이 그려진다 — 새로고침으로 위임한다.
          if (
            next.problem_type !== roomRef.current.problem_type ||
            next.situation !== roomRef.current.situation
          ) {
            router.refresh();
            return;
          }
          setRoom(next);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_conflicts", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<RoleConflict>;
            setConflicts((current) => current.filter((c) => c.id !== old.id));
            return;
          }
          const next = payload.new as RoleConflict;
          setConflicts((current) => {
            if (payload.eventType === "INSERT" && current.some((c) => c.id === next.id)) return current;
            if (payload.eventType === "UPDATE") return current.map((c) => (c.id === next.id ? next : c));
            return [...current, next];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_conflict_choices", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<RoleConflictChoice>;
            setConflictChoices((current) => current.filter((c) => c.id !== old.id));
            return;
          }
          const next = payload.new as RoleConflictChoice;
          setConflictChoices((current) => [...current.filter((c) => c.id !== next.id), next]);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_roles", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<CustomRole>;
            setCustomCandidates((current) => current.filter((r) => r.id !== old.id));
            if (old.id) setSelectedCandidates((current) => current.filter((entry) => entry !== old.id));
            return;
          }
          const next = payload.new as CustomRole;
          setCustomCandidates((current) => [...current.filter((r) => r.id !== next.id), next]);
          if (payload.eventType === "INSERT") {
            setSelectedCandidates((current) => (current.includes(next.id) ? current : [...current, next.id]));
          }
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
      .catch(() => {});
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
      const result = await startDecisionGame(room.id, selectedCandidateNames);
      if (!result.ok) setStartError(result.error);
    });
  }

  function toggleCandidate(entry: string) {
    setSelectedCandidates((current) =>
      current.includes(entry) ? current.filter((c) => c !== entry) : [...current, entry]
    );
  }

  function handleAddCandidate() {
    if (!myMemberId) return;
    setCandidateError(null);
    startCandidateAction(async () => {
      const result = await addCustomRole(room.id, myMemberId, newCandidateName, "", null);
      if (!result.ok) {
        setCandidateError(result.error);
        return;
      }
      setNewCandidateName("");
      setAddingCandidate(false);
    });
  }

  function handleDeleteCandidate(candidateId: string) {
    if (!myMemberId) return;
    setSelectedCandidates((current) => current.filter((entry) => entry !== candidateId));
    startCandidateAction(async () => {
      await deleteCustomRole(candidateId, myMemberId);
    });
  }

  function handlePickRank(rank: number, item: string | null) {
    if (!myMemberId) return;
    submitPreference(room.id, myMemberId, rank, item);
  }

  function handleConflictChoice(conflictId: string, choice: ConflictChoice) {
    if (!myMemberId) return;
    submitConflictChoice(room.id, conflictId, myMemberId, choice);
  }

  function handleRpsMove(conflictId: string, move: RpsMove) {
    if (!myMemberId) return;
    submitRpsMove(conflictId, myMemberId, move);
  }

  function handleResolve() {
    setResolveError(null);
    startResolving(async () => {
      const result = await resolveDecision(room.id);
      if (!result.ok) setResolveError(result.error);
    });
  }

  function handleRestart() {
    setDismissedRound(null);
    startRestarting(async () => {
      await restartRound(room.id);
    });
  }

  function handleLeave() {
    if (myMemberId) {
      removeMember(myMemberId);
      clearMyMemberId(room.id);
    }
    router.push("/");
  }

  const activeCandidates =
    room.active_roles && room.active_roles.length > 0 ? room.active_roles : defaultCandidates;
  const maxRank = Math.min(3, activeCandidates.length);
  const myRanks = new Map<number, string>();
  for (const p of preferences) if (p.member_id === myMemberId) myRanks.set(p.rank, p.role_label);

  const tally1 = new Map<string, number>();
  for (const c of activeCandidates) tally1.set(c, 0);
  for (const p of preferences) if (p.rank === 1) tally1.set(p.role_label, (tally1.get(p.role_label) ?? 0) + 1);

  const workingRound = room.round + 1;
  const settledThisRound = assignments
    .filter((a) => a.round === workingRound)
    .sort((a, b) => (a.assigned_rank ?? 0) - (b.assigned_rank ?? 0));
  const activeConflicts = conflicts.filter((c) => c.round === workingRound && c.status !== "resolved");
  const finalAssignments = assignments
    .filter((a) => a.round === room.round)
    .sort((a, b) => (a.assigned_rank ?? 99) - (b.assigned_rank ?? 99));

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 새 방
          </Link>
          <span>지금까지 {room.round}번 진행했어요</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{room.task}</h1>
            <p className="text-sm text-zinc-400">{situationLabel}</p>
          </div>
          <button
            onClick={() => setView(view === "history" ? "game" : "history")}
            className="shrink-0 rounded-xl border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50"
          >
            {view === "history" ? "← 게임" : "📋 기록"}
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400">{shareUrl}</span>
          <button onClick={handleCopy} className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
      </header>

      {view === "history" ? (
        <DecisionHistorySection assignments={assignments} situationLabel={situationLabel} />
      ) : (
        <>
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
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-500">{label}</h2>

              <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-col gap-1.5">
                  {defaultCandidates.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={selectedCandidates.includes(c)}
                        onChange={() => toggleCandidate(c)}
                        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                      />
                      {c}
                    </label>
                  ))}
                </div>

                {customCandidates.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <span className="text-xs font-semibold text-zinc-400">✏️ 추가한 후보</span>
                    {customCandidates.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <label className="flex flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedCandidates.includes(c.id)}
                            onChange={() => toggleCandidate(c.id)}
                            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                          />
                          {c.name}
                        </label>
                        {c.created_by === myMemberId && (
                          <button onClick={() => handleDeleteCandidate(c.id)} className="text-xs text-zinc-400 hover:text-red-500">
                            삭제
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {addingCandidate ? (
                  <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <input
                      value={newCandidateName}
                      onChange={(e) => setNewCandidateName(e.target.value)}
                      maxLength={20}
                      placeholder="후보 이름"
                      className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddCandidate}
                        disabled={candidatePending || !myMemberId}
                        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
                      >
                        추가하기
                      </button>
                      <button
                        onClick={() => setAddingCandidate(false)}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        취소
                      </button>
                    </div>
                    {!myMemberId && <p className="text-xs text-zinc-400">참가해야 후보를 추가할 수 있어요</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingCandidate(true)}
                    className="self-start border-t border-zinc-100 pt-3 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-50"
                  >
                    ＋ 후보 추가
                  </button>
                )}
                {candidateError && <p className="text-sm text-red-500">{candidateError}</p>}
              </div>

              <button
                onClick={handleStart}
                disabled={members.length < 2 || selectedCandidates.length < 2 || starting}
                className="h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {starting ? "준비하는 중..." : "게임 시작"}
              </button>
              {members.length < 2 && (
                <p className="text-center text-sm text-zinc-500">참가자가 2명 이상이어야 시작할 수 있어요</p>
              )}
              {members.length >= 2 && selectedCandidates.length < 2 && (
                <p className="text-center text-sm text-zinc-500">후보가 2개 이상 필요해요</p>
              )}
              {startError && <p className="text-center text-sm text-red-500">{startError}</p>}
            </section>
          )}

          {room.game_phase === "preference" && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-500">
                {me ? `원하는 순서대로 최대 ${maxRank}개까지 골라주세요` : "후보"}
              </h2>

              {me ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: maxRank }, (_, i) => i + 1).map((rank) => {
                    const chosen = myRanks.get(rank) ?? "";
                    const available = activeCandidates.filter((c) => {
                      for (const [otherRank, otherItem] of myRanks) {
                        if (otherRank !== rank && otherItem === c) return false;
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
                          {available.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">참가하면 선택할 수 있어요</p>
              )}

              <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-xs font-semibold text-zinc-400">1지망 신청 현황</span>
                {activeCandidates.map((c) => (
                  <div key={c} className="flex items-center justify-between">
                    <span className="text-zinc-700 dark:text-zinc-300">{c}</span>
                    <span className="text-zinc-400">{tally1.get(c) ?? 0}명</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleResolve}
                disabled={resolving}
                className="mt-2 h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {resolving ? "확인하는 중..." : "충돌 확인하기"}
              </button>
              {resolveError && <p className="text-center text-sm text-red-500">{resolveError}</p>}
            </section>
          )}

          {room.game_phase === "conflict" && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-500">충돌 해결 중</h2>

              {mode === "ordering" && settledThisRound.length > 0 && (
                <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-xs font-semibold text-zinc-400">이미 정해진 순서</span>
                  {settledThisRound.map((a) => (
                    <div key={a.id} className="flex items-center gap-2">
                      <span className="text-zinc-400">{medal(a.assigned_rank)}</span>
                      <span className="text-zinc-700 dark:text-zinc-300">{a.role_label}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-3">
                {activeConflicts.map((conflict) => (
                  <DecisionConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    members={members}
                    choices={conflictChoices}
                    myMemberId={myMemberId}
                    myPriorityUsed={me?.priority_token_used ?? false}
                    myCardUsed={me?.card_token_used ?? false}
                    onChoice={handleConflictChoice}
                    onRpsMove={handleRpsMove}
                  />
                ))}
              </div>
            </section>
          )}

          {room.game_phase === "result" && (
            <section className="flex flex-col gap-3">
              {viewingResult ? (
                <>
                  {mode === "single-choice" ? (
                    <div className="text-center">
                      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">🎉 {resultTitle}</h2>
                      <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                        {finalAssignments[0]?.role_label ?? "-"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">참여자 전원 결정 완료!</p>
                      <div className="mt-4 flex flex-col gap-1.5">
                        {finalAssignments.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <span className="text-zinc-700 dark:text-zinc-300">{a.member_name}</span>
                            <span className="text-zinc-400">{rankBadge(a.assigned_rank)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-center">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">🎉 {resultTitle}</h2>
                      </div>
                      <div className="mt-4 flex flex-col gap-2">
                        {finalAssignments.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <span className="text-2xl">{medal(a.assigned_rank)}</span>
                            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{a.role_label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-center text-sm text-zinc-500">방 대기 화면이에요.</p>
              )}

              {showTopicSwitcher ? (
                <TopicSwitcher
                  roomId={room.id}
                  currentProblemType={room.problem_type}
                  onCancel={() => setShowTopicSwitcher(false)}
                />
              ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleRestart}
                  disabled={restarting}
                  className="h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {restarting ? "준비하는 중..." : "🔄 다시 하기"}
                </button>
                <button
                  onClick={() => setShowTopicSwitcher(true)}
                  className="h-11 w-full rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50"
                >
                  🔀 주제 바꾸기
                </button>
                <button
                  onClick={() => setDismissedRound(viewingResult ? room.round : null)}
                  className="h-11 w-full rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50"
                >
                  {viewingResult ? "🏠 방으로 돌아가기" : "결과 다시 보기"}
                </button>
                <button
                  onClick={handleLeave}
                  className="h-11 w-full rounded-xl text-sm font-medium text-zinc-400 transition-colors hover:text-red-500"
                >
                  🚪 나가기
                </button>
              </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function medal(position: number | null): string {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return position ? `${position}.` : "";
}

function rankBadge(assignedRank: number | null): string {
  if (assignedRank === 1) return "🎉 1지망";
  if (assignedRank === 2) return "👍 2지망";
  if (assignedRank === 3) return "😅 3지망";
  return "💤 비선호";
}

function DecisionHistorySection({
  assignments,
  situationLabel,
}: {
  assignments: RoleAssignment[];
  situationLabel: string;
}) {
  const byRound = new Map<number, RoleAssignment[]>();
  for (const a of assignments) {
    if (!byRound.has(a.round)) byRound.set(a.round, []);
    byRound.get(a.round)!.push(a);
  }
  const rounds = [...byRound.keys()].sort((a, b) => b - a);

  if (rounds.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        아직 완료된 게임이 없어요.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-500">📋 게임 기록</h2>
      {rounds.map((round) => {
        const rows = byRound.get(round)!.sort((a, b) => (a.assigned_rank ?? 99) - (b.assigned_rank ?? 99));
        const date = new Date(rows[0].created_at).toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const summary = summarizeRound(rows);
        const topicLabel = problemTypeLabel(rows[0]?.game_type, situationLabel);
        return (
          <div
            key={round}
            className="flex flex-col gap-1 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{date}</span>
            <span className="text-xs text-zinc-400">{topicLabel}</span>
            <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {summary.kind === "shared" && `결과: ${summary.result}`}
              {summary.kind === "ordered" && summary.items.join(" → ")}
              {summary.kind === "per-member" && summary.lines.join(", ")}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function DecisionConflictCard({
  conflict,
  members,
  choices,
  myMemberId,
  myPriorityUsed,
  myCardUsed,
  onChoice,
  onRpsMove,
}: {
  conflict: RoleConflict;
  members: Member[];
  choices: RoleConflictChoice[];
  myMemberId: string | null;
  myPriorityUsed: boolean;
  myCardUsed: boolean;
  onChoice: (conflictId: string, choice: ConflictChoice) => void;
  onRpsMove: (conflictId: string, move: RpsMove) => void;
}) {
  const myChoice = choices.find((c) => c.conflict_id === conflict.id && c.member_id === myMemberId);
  const iAmCandidate = myMemberId != null && conflict.candidate_ids.includes(myMemberId);

  const pendingNames = conflict.candidate_ids
    .filter((id) => !choices.find((c) => c.conflict_id === conflict.id && c.member_id === id)?.choice)
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{conflict.role_label}</p>

      {conflict.status === "choosing" &&
        (!iAmCandidate ? (
          <p className="mt-2 text-sm text-zinc-500">
            {pendingNames}님의 선택을 기다리는 중... (이름을 탭해서 대신 선택할 수 있어요)
          </p>
        ) : myChoice?.choice ? (
          <p className="mt-2 text-sm text-zinc-500">선택 완료! 상대를 기다리는 중...</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChoice(conflict.id, "priority")}
              disabled={myPriorityUsed}
              className="rounded-xl border border-zinc-300 py-2 text-sm transition-colors hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:border-zinc-50"
            >
              🔥 우선권
            </button>
            <button
              type="button"
              onClick={() => onChoice(conflict.id, "card")}
              disabled={myCardUsed}
              className="rounded-xl border border-zinc-300 py-2 text-sm transition-colors hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:border-zinc-50"
            >
              🃏 카드
            </button>
            <button
              type="button"
              onClick={() => onChoice(conflict.id, "duel")}
              className="rounded-xl border border-zinc-300 py-2 text-sm transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-50"
            >
              🎲 승부
            </button>
            <button
              type="button"
              onClick={() => onChoice(conflict.id, "concede")}
              className="rounded-xl border border-zinc-300 py-2 text-sm transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-50"
            >
              🤝 양보
            </button>
          </div>
        ))}

      {conflict.status === "rps" && (
        <DecisionRpsSection
          conflict={conflict}
          members={members}
          choices={choices}
          myMemberId={myMemberId}
          onRpsMove={onRpsMove}
        />
      )}
    </div>
  );
}

function DecisionRpsSection({
  conflict,
  members,
  choices,
  myMemberId,
  onRpsMove,
}: {
  conflict: RoleConflict;
  members: Member[];
  choices: RoleConflictChoice[];
  myMemberId: string | null;
  onRpsMove: (conflictId: string, move: RpsMove) => void;
}) {
  const finalistIds = conflict.finalist_ids ?? [];
  const iAmFinalist = myMemberId != null && finalistIds.includes(myMemberId);
  const myMove = choices.find((c) => c.conflict_id === conflict.id && c.member_id === myMemberId)?.rps_move;
  const finalistNames = finalistIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(" vs ");

  return (
    <div className="mt-2">
      <p className="text-sm text-zinc-500">선택이 겹쳤어요 — 가위바위보로 정해요!</p>
      {!iAmFinalist ? (
        <p className="mt-2 text-sm text-zinc-500">
          {finalistNames} 대결 중... (이름을 탭해서 대신 낼 수 있어요)
        </p>
      ) : myMove ? (
        <p className="mt-2 text-sm text-zinc-500">냈어요! 상대를 기다리는 중...</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onRpsMove(conflict.id, "rock")}
            className="flex-1 rounded-xl border border-zinc-300 py-2 text-xl transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-50"
          >
            ✊
          </button>
          <button
            type="button"
            onClick={() => onRpsMove(conflict.id, "scissors")}
            className="flex-1 rounded-xl border border-zinc-300 py-2 text-xl transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-50"
          >
            ✌️
          </button>
          <button
            type="button"
            onClick={() => onRpsMove(conflict.id, "paper")}
            className="flex-1 rounded-xl border border-zinc-300 py-2 text-xl transition-colors hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-50"
          >
            ✋
          </button>
        </div>
      )}
    </div>
  );
}
