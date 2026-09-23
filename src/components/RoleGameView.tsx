"use client";
// 역할 게임 화면. lobby(참가자 모으기) -> preference(1지망 선택) -> result(결과) 순서로
// 진행되고, 전부 이 컴포넌트 하나가 room.game_phase를 보고 갈아 끼운다(새 라우트 없음).
// 데이터 흐름은 기존 RoomView와 같은 원칙: 초기값은 서버 컴포넌트가 props로 주고,
// 이후 변경은 Supabase Realtime 구독으로만 반영한다 — 내가 한 액션도 서버 왕복 후
// 이 채널로 돌아오므로 성공 시 로컬 state를 직접 조작할 필요가 없다.
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addCustomRole,
  addMember,
  cancelSwapProposal,
  deleteCustomRole,
  proposeSwap,
  removeMember,
  resolveRoles,
  respondToSwap,
  restartRound,
  setPreferenceLevel,
  setSkillLevel,
  startGame,
  submitConflictChoice,
  submitPreference,
  submitRpsMove,
  updateCustomRole,
} from "@/app/actions";
import { clearMyMemberId, getMyMemberId, setMyMemberId } from "@/lib/identity";
import { getSupabase } from "@/lib/supabase";
import type {
  ConflictChoice,
  CustomRole,
  Member,
  PlayerSkill,
  Room,
  RoleAssignment,
  RoleConflict,
  RoleConflictChoice,
  RolePreference,
  RoleSwapProposal,
  RpsMove,
} from "@/lib/types";

export function RoleGameView({
  initialRoom,
  initialMembers,
  initialPreferences,
  initialAssignments,
  initialConflicts,
  initialConflictChoices,
  initialCustomRoles,
  initialPlayerSkills,
  initialSwapProposals,
  recommendedRoles,
  skillCategories,
  situationLabel,
  recurring,
}: {
  initialRoom: Room;
  initialMembers: Member[];
  initialPreferences: RolePreference[];
  initialAssignments: RoleAssignment[];
  initialConflicts: RoleConflict[];
  initialConflictChoices: RoleConflictChoice[];
  initialCustomRoles: CustomRole[];
  initialPlayerSkills: PlayerSkill[];
  initialSwapProposals: RoleSwapProposal[];
  recommendedRoles: string[];
  skillCategories: string[];
  situationLabel: string;
  recurring: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => getSupabase());
  const [room, setRoom] = useState(initialRoom);
  const [members, setMembers] = useState(initialMembers);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [conflictChoices, setConflictChoices] = useState(initialConflictChoices);
  const [customRoles, setCustomRoles] = useState(initialCustomRoles);
  const [playerSkills, setPlayerSkills] = useState(initialPlayerSkills);
  const [swapProposals, setSwapProposals] = useState(initialSwapProposals);

  // 이번 게임에서 실제로 쓰기로 고른 역할들("게임 시작" 누르기 전까지는 이 브라우저만
  // 아는 초안이다 — 다 같이 실시간으로 체크박스를 맞출 필요까진 없어서 로컬로 둔다).
  // 추천 역할은 이름 문자열 자체가 안 바뀌니 이름으로 저장하지만, 커스텀 역할은 id로
  // 저장한다 — 이름으로 저장하면 방장이 역할 이름을 수정했을 때 옛 이름이 선택 목록에
  // 유령처럼 남고 체크박스는 풀려 보이는 불일치가 생긴다(실제로 겪은 버그).
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() => {
    if (initialRoom.active_roles && initialRoom.active_roles.length > 0) {
      return initialRoom.active_roles.map((name) => {
        const custom = initialCustomRoles.find((r) => r.name === name);
        return custom ? custom.id : name;
      });
    }
    return [...recommendedRoles, ...initialCustomRoles.map((r) => r.id)];
  });
  // selectedRoles(추천 역할 이름 | 커스텀 역할 id 섞인 배열)를 실제 역할 이름 배열로
  // 바꾼다 — 커스텀 역할은 항상 지금 이름(customRoles에서 조회)을 쓰므로 수정 후에도 안 어긋난다.
  const selectedRoleNames = selectedRoles.map(
    (entry) => customRoles.find((r) => r.id === entry)?.name ?? entry
  );

  // 게임 화면 / 기록 화면 전환. 방 상태를 바꾸지 않는 이 브라우저만의 화면이다.
  const [view, setView] = useState<"game" | "history">("game");
  const [historyRound, setHistoryRound] = useState<number | null>(null);

  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [roleActionError, setRoleActionError] = useState<string | null>(null);
  const [newRoleSkill, setNewRoleSkill] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleDescription, setEditRoleDescription] = useState("");
  const [editRoleSkill, setEditRoleSkill] = useState("");

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
  const [roleActionPending, startRoleAction] = useTransition();

  // "방으로 돌아가기"는 방 상태를 바꾸지 않는, 이 브라우저만의 화면 전환이다(다른 사람은
  // 여전히 결과를 볼 수 있어야 하니까). 어떤 라운드를 넘겼는지만 기억해두면, 다음
  // 라운드 결과가 나왔을 때 자동으로 다시 보이게 할 수 있다(round가 바뀌면 조건이 깨짐).
  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const viewingResult = dismissedRound !== room.round;

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
            setCustomRoles((current) => current.filter((r) => r.id !== old.id));
            // 선택 목록에 그 역할의 id가 남아있으면(=삭제한 사람 본인 화면이 아니라면)
            // 같이 지워서 유령 항목이 남지 않게 한다.
            if (old.id) setSelectedRoles((current) => current.filter((entry) => entry !== old.id));
            return;
          }
          const next = payload.new as CustomRole;
          setCustomRoles((current) => {
            const withoutOld = current.filter((r) => r.id !== next.id);
            return [...withoutOld, next];
          });
          // 새로 생긴 커스텀 역할은 기본으로 이번 게임에 포함시킨다(다들 쓰려고 만든
          // 거라고 가정). id로 저장해서 나중에 이름이 바뀌어도 선택 상태가 안 어긋난다.
          if (payload.eventType === "INSERT") {
            setSelectedRoles((current) => (current.includes(next.id) ? current : [...current, next.id]));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_skills", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<PlayerSkill>;
            setPlayerSkills((current) => current.filter((s) => s.id !== old.id));
            return;
          }
          const next = payload.new as PlayerSkill;
          setPlayerSkills((current) => {
            const withoutOld = current.filter(
              (s) => !(s.member_id === next.member_id && s.skill_category === next.skill_category)
            );
            return [...withoutOld, next];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_swap_proposals", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<RoleSwapProposal>;
            setSwapProposals((current) => current.filter((p) => p.id !== old.id));
            return;
          }
          const next = payload.new as RoleSwapProposal;
          setSwapProposals((current) => [...current.filter((p) => p.id !== next.id), next]);
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
      const result = await startGame(room.id, selectedRoleNames);
      if (!result.ok) setStartError(result.error);
    });
  }

  function toggleRole(name: string) {
    setSelectedRoles((current) =>
      current.includes(name) ? current.filter((r) => r !== name) : [...current, name]
    );
  }

  function handleAddRole() {
    if (!myMemberId) return;
    setRoleActionError(null);
    startRoleAction(async () => {
      const result = await addCustomRole(
        room.id,
        myMemberId,
        newRoleName,
        newRoleDescription,
        newRoleSkill || null
      );
      if (!result.ok) {
        setRoleActionError(result.error);
        return;
      }
      setNewRoleName("");
      setNewRoleDescription("");
      setNewRoleSkill("");
      setAddingRole(false);
    });
  }

  function startEditRole(role: CustomRole) {
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
    setEditRoleDescription(role.description ?? "");
    setEditRoleSkill(role.skill_category ?? "");
  }

  function handleSaveRoleEdit() {
    if (!myMemberId || !editingRoleId) return;
    setRoleActionError(null);
    startRoleAction(async () => {
      const result = await updateCustomRole(
        editingRoleId,
        myMemberId,
        editRoleName,
        editRoleDescription,
        editRoleSkill || null
      );
      if (!result.ok) {
        setRoleActionError(result.error);
        return;
      }
      setEditingRoleId(null);
    });
  }

  function handleSetSkill(category: string, level: number) {
    if (!myMemberId) return;
    setSkillLevel(room.id, myMemberId, category, level);
  }

  function handleSetPreference(category: string, level: number) {
    if (!myMemberId) return;
    setPreferenceLevel(room.id, myMemberId, category, level);
  }

  function handleDeleteRole(roleId: string) {
    if (!myMemberId) return;
    setSelectedRoles((current) => current.filter((entry) => entry !== roleId));
    startRoleAction(async () => {
      await deleteCustomRole(roleId, myMemberId);
    });
  }

  function handlePickRank(rank: number, roleLabel: string | null) {
    if (!myMemberId) return;
    submitPreference(room.id, myMemberId, rank, roleLabel);
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
      const result = await resolveRoles(room.id);
      if (!result.ok) setResolveError(result.error);
    });
  }

  function handleRestart() {
    setDismissedRound(null);
    startRestarting(async () => {
      await restartRound(room.id);
    });
  }

  function handleProposeSwap(targetId: string) {
    if (!myMemberId) return;
    proposeSwap(room.id, room.round, myMemberId, targetId);
  }

  function handleCancelSwap(proposalId: string) {
    if (!myMemberId) return;
    cancelSwapProposal(proposalId, myMemberId);
  }

  function handleRespondSwap(proposalId: string, accept: boolean) {
    if (!myMemberId) return;
    respondToSwap(proposalId, myMemberId, accept);
  }

  function handleLeave() {
    if (myMemberId) {
      removeMember(myMemberId);
      clearMyMemberId(room.id);
    }
    router.push("/");
  }

  // 실제로 진행 중인 게임의 역할 목록 — "게임 시작" 때 고른 스냅샷(room.active_roles).
  // 아직 한 번도 시작 안 해본(=이 기능 이전에 만들어진) 방은 추천 역할 전체로 대체한다.
  const activeRoles = room.active_roles && room.active_roles.length > 0 ? room.active_roles : recommendedRoles;

  const maxRank = Math.min(3, activeRoles.length);
  const myRanks = new Map<number, string>();
  for (const p of preferences) if (p.member_id === myMemberId) myRanks.set(p.rank, p.role_label);

  // 1지망 신청 현황만 보여준다 — 충돌이 생길지 미리 짐작할 수 있게 하는 용도라
  // 2·3지망까지 다 합쳐서 보여주면 오히려 헷갈린다.
  const tally1 = new Map<string, number>();
  for (const role of activeRoles) tally1.set(role, 0);
  for (const p of preferences) if (p.rank === 1) tally1.set(p.role_label, (tally1.get(p.role_label) ?? 0) + 1);

  // 지금 진행 중인 라운드(아직 game_phase가 'result'로 안 바뀐 라운드)를 기준으로,
  // 이미 배정 끝난 역할(충돌 없이 바로 정해진 것들)과 아직 진행 중인 충돌을 나눠 보여준다.
  const workingRound = room.round + 1;
  const settledThisRound = assignments.filter((a) => a.round === workingRound);
  const activeConflicts = conflicts.filter((c) => c.round === workingRound && c.status !== "resolved");

  // 결과 확정 후 역할 교환 — 이번 라운드에 걸린 대기 중인 제안 중 내가 보낸 것/받은 것.
  // 한 번에 하나씩만 진행하게 해서(서버에서도 같은 규칙으로 막는다) 여러 제안이 얽혀
  // 헷갈리는 상황을 피한다.
  const myResultAssignment =
    assignments.find((a) => a.round === room.round && a.member_id === myMemberId) ?? null;
  const roundSwapProposals = swapProposals.filter((p) => p.round === room.round);
  const myOutgoingSwap = myMemberId
    ? roundSwapProposals.find((p) => p.status === "pending" && p.proposer_id === myMemberId) ?? null
    : null;
  const myIncomingSwap = myMemberId
    ? roundSwapProposals.find((p) => p.status === "pending" && p.target_id === myMemberId) ?? null
    : null;

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
        <HistorySection
          assignments={assignments}
          situationLabel={situationLabel}
          historyRound={historyRound}
          onSelectRound={setHistoryRound}
        />
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
        {members.length > 1 && (
          <p className="text-xs text-zinc-400">
            이름을 탭하면 그 사람이 돼요 — 지망 선택, 충돌 대응까지 그 사람 대신 할 수
            있어요. 혼자 시연할 때 유용해요.
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
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-500">🎯 어떤 일을 맡을까요?</h2>

          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-400">⭐ 추천 역할</span>
              {recommendedRoles.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                  />
                  {role}
                </label>
              ))}
            </div>

            {customRoles.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-400">✏️ 내가 만든 역할</span>
                {customRoles.map((role) =>
                  editingRoleId === role.id ? (
                    <div key={role.id} className="flex flex-col gap-1.5 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
                      <input
                        value={editRoleName}
                        onChange={(e) => setEditRoleName(e.target.value)}
                        maxLength={20}
                        placeholder="역할 이름"
                        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <input
                        value={editRoleDescription}
                        onChange={(e) => setEditRoleDescription(e.target.value)}
                        maxLength={60}
                        placeholder="역할 설명(선택)"
                        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <select
                        value={editRoleSkill}
                        onChange={(e) => setEditRoleSkill(e.target.value)}
                        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      >
                        <option value="">관련 능력 없음</option>
                        {skillCategories.map((skill) => (
                          <option key={skill} value={skill}>
                            {skill}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveRoleEdit}
                          disabled={roleActionPending}
                          className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setEditingRoleId(null)}
                          className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={role.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <label className="flex flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedRoles.includes(role.id)}
                          onChange={() => toggleRole(role.id)}
                          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                        />
                        {role.name}
                        {role.description && (
                          <span className="text-xs text-zinc-400">— {role.description}</span>
                        )}
                      </label>
                      {role.created_by === myMemberId && (
                        <div className="flex shrink-0 gap-2 text-xs text-zinc-400">
                          <button onClick={() => startEditRole(role)} className="hover:text-zinc-900 dark:hover:text-zinc-50">
                            수정
                          </button>
                          <button onClick={() => handleDeleteRole(role.id)} className="hover:text-red-500">
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            {addingRole ? (
              <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  maxLength={20}
                  placeholder="역할 이름 (예: 화장실 청소)"
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <input
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  maxLength={60}
                  placeholder="역할 설명(선택)"
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <select
                  value={newRoleSkill}
                  onChange={(e) => setNewRoleSkill(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  <option value="">관련 능력 없음</option>
                  {skillCategories.map((skill) => (
                    <option key={skill} value={skill}>
                      {skill}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddRole}
                    disabled={roleActionPending || !myMemberId}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    추가하기
                  </button>
                  <button
                    onClick={() => setAddingRole(false)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    취소
                  </button>
                </div>
                {!myMemberId && <p className="text-xs text-zinc-400">참가해야 역할을 추가할 수 있어요</p>}
              </div>
            ) : (
              <button
                onClick={() => setAddingRole(true)}
                className="self-start border-t border-zinc-100 pt-3 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-50"
              >
                ＋ 역할 추가
              </button>
            )}
            {roleActionError && <p className="text-sm text-red-500">{roleActionError}</p>}
          </div>

          <button
            onClick={handleStart}
            disabled={members.length < 2 || selectedRoles.length < members.length || starting}
            className="h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {starting ? "준비하는 중..." : "게임 시작"}
          </button>
          {members.length < 2 && (
            <p className="text-center text-sm text-zinc-500">참가자가 2명 이상이어야 시작할 수 있어요</p>
          )}
          {members.length >= 2 && selectedRoles.length < members.length && (
            <p className="text-center text-sm text-zinc-500">
              참가자({members.length}명)보다 역할({selectedRoles.length}개)이 적어요
            </p>
          )}
          {startError && <p className="text-center text-sm text-red-500">{startError}</p>}
        </section>
      )}

      {room.game_phase === "preference" && me && skillCategories.length > 0 && (
        <SkillRatingSection
          skillCategories={skillCategories}
          playerSkills={playerSkills}
          myMemberId={myMemberId}
          onSetSkill={handleSetSkill}
          onSetPreference={handleSetPreference}
        />
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
                const availableRoles = activeRoles.filter((role) => {
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
            {activeRoles.map((role) => (
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
            {resolving ? "확인하는 중..." : "충돌 확인하기"}
          </button>
          <p className="text-center text-sm text-zinc-500">
            지망이 겹치는 역할만 우선권·양보·승부로 정하고, 나머지는 바로 배정돼요.
          </p>
          {resolveError && <p className="text-center text-sm text-red-500">{resolveError}</p>}
        </section>
      )}

      {room.game_phase === "conflict" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-500">{room.conflict_rank}지망 충돌 해결 중</h2>

          {settledThisRound.length > 0 && (
            <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-xs font-semibold text-zinc-400">이미 정해진 역할</span>
              {settledThisRound.map((a) => (
                <div key={a.id} className="flex items-center justify-between">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {a.member_name} → {a.role_label}
                  </span>
                  <span className="text-zinc-400">{rankBadge(a.assigned_rank)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {activeConflicts.map((conflict) => (
              <ConflictCard
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
              <div className="text-center">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  {recurring ? "🎉 이번 주 당번 완료!" : "🎉 역할 배정 완료!"}
                </h2>
                <p className="text-sm text-zinc-500">이번 게임의 최종 결과예요.</p>
              </div>

              {myIncomingSwap && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    <strong>{members.find((m) => m.id === myIncomingSwap.proposer_id)?.name}</strong>
                    님이 역할을 서로 바꾸자고 제안했어요.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleRespondSwap(myIncomingSwap.id, true)}
                      className="flex-1 rounded-xl bg-zinc-900 py-2 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      수락
                    </button>
                    <button
                      onClick={() => handleRespondSwap(myIncomingSwap.id, false)}
                      className="flex-1 rounded-xl border border-zinc-300 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      거절
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {assignments
                  .filter((a) => a.round === room.round)
                  .map((a) => {
                    const isMe = a.member_id === myMemberId;
                    const canPropose =
                      !isMe &&
                      myMemberId != null &&
                      a.member_id != null &&
                      myResultAssignment != null &&
                      a.role_label !== myResultAssignment.role_label &&
                      !myOutgoingSwap &&
                      !myIncomingSwap;
                    const isMyOutgoingTarget = myOutgoingSwap?.target_id === a.member_id;
                    return (
                      <div
                        key={a.id}
                        className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <p className="text-sm text-zinc-400">
                          👤 {a.member_name}
                          {isMe && " (나)"}
                        </p>
                        <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-50">{a.role_label}</p>
                        <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
                          <span>{rankBadge(a.assigned_rank)}</span>
                          {resolutionTag(a.resolved_by) && <span>· {resolutionTag(a.resolved_by)}</span>}
                        </div>
                        {a.skill_level != null && (
                          <p className="mt-1 text-xs text-zinc-400">
                            능력 {skillStars(a.skill_level) || "–"} · 선호 {prefHearts(a.preference_level) || "–"}
                          </p>
                        )}
                        {canPropose && (
                          <button
                            onClick={() => handleProposeSwap(a.member_id!)}
                            className="mt-2 rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-50"
                          >
                            🔄 교환 제안
                          </button>
                        )}
                        {isMyOutgoingTarget && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                            <span>응답 대기 중...</span>
                            <button
                              onClick={() => handleCancelSwap(myOutgoingSwap!.id)}
                              className="text-zinc-400 hover:text-red-500"
                            >
                              취소
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-zinc-500">방 대기 화면이에요.</p>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="h-12 w-full rounded-xl bg-zinc-900 text-base font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {restarting ? "준비하는 중..." : recurring ? "🔄 다음 주 당번 정하기" : "🔄 다시 하기"}
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
        </section>
      )}
        </>
      )}
    </div>
  );
}

// 📋 게임 기록 — 새 데이터를 따로 조회하지 않고, 이미 실시간으로 들고 있는
// assignments를 round별로 묶어서 보여준다(role_assignments를 더 이상 지우지 않게
// 바꿔둔 덕분에 지난 라운드가 전부 여기 남아있다).
function HistorySection({
  assignments,
  situationLabel,
  historyRound,
  onSelectRound,
}: {
  assignments: RoleAssignment[];
  situationLabel: string;
  historyRound: number | null;
  onSelectRound: (round: number | null) => void;
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

  if (historyRound !== null && byRound.has(historyRound)) {
    const sessionAssignments = byRound.get(historyRound)!;
    const usedRoles = [...new Set(sessionAssignments.map((a) => a.role_label))];
    const date = formatSessionDate(sessionAssignments[0].created_at);
    return (
      <section className="flex flex-col gap-3">
        <button
          onClick={() => onSelectRound(null)}
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← 기록 목록
        </button>
        <div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">📋 {date}</h2>
          <p className="text-sm text-zinc-400">{situationLabel}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-semibold text-zinc-400">사용한 역할</span>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">{usedRoles.join(" · ")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {sessionAssignments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {a.member_name} → {a.role_label}
                </span>
                {a.skill_level != null && (
                  <p className="text-xs text-zinc-400">
                    능력 {skillStars(a.skill_level) || "–"} · 선호 {prefHearts(a.preference_level) || "–"}
                  </p>
                )}
              </div>
              <span className="text-xs text-zinc-400">{rankBadge(a.assigned_rank)}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-500">📋 게임 기록</h2>
      {rounds.map((round) => {
        const sessionAssignments = byRound.get(round)!;
        const date = formatSessionDate(sessionAssignments[0].created_at);
        return (
          <button
            key={round}
            onClick={() => onSelectRound(round)}
            className="flex flex-col gap-1.5 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-50"
          >
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{date}</span>
            <span className="text-xs text-zinc-400">{situationLabel}</span>
            <div className="mt-1 flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              {sessionAssignments.map((a) => (
                <span key={a.id}>
                  {a.member_name} → {a.role_label}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function rankBadge(assignedRank: number | null): string {
  if (assignedRank === 1) return "🎉 1지망";
  if (assignedRank === 2) return "👍 2지망";
  if (assignedRank === 3) return "😅 3지망";
  return "💤 비선호 역할";
}

// 능력/선호는 별점/하트 개수로만 간단히 보여준다 — 스펙 2번("슬라이더나 복잡한 수치
// 입력은 쓰지 않는다")과 같은 정신으로 표시도 최대한 단순하게 유지한다.
function skillStars(level: number | null | undefined): string {
  return level ? "⭐".repeat(level) : "";
}

function prefHearts(level: number | null | undefined): string {
  return level ? "❤️".repeat(level) : "";
}

// 게임 시작 전, 각자 이번 상황과 관련된 능력/선호를 스스로 매긴다(스펙 1~2번). 능력이
// 높다고 자동으로 역할을 주지 않는다 — 이 값은 어디까지나 충돌 카드/결과에 보여주는
// "참고 정보"고, 실제 결정은 여전히 지망 선택 + 우선권/양보/승부가 한다.
function SkillRatingSection({
  skillCategories,
  playerSkills,
  myMemberId,
  onSetSkill,
  onSetPreference,
}: {
  skillCategories: string[];
  playerSkills: PlayerSkill[];
  myMemberId: string | null;
  onSetSkill: (category: string, level: number) => void;
  onSetPreference: (category: string, level: number) => void;
}) {
  const mySkills = new Map(
    playerSkills.filter((s) => s.member_id === myMemberId).map((s) => [s.skill_category, s])
  );

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold text-zinc-500">💪 내가 잘하는 것 / ❤️ 내가 좋아하는 것</h2>
        <p className="text-xs text-zinc-400">참고용 정보예요 — 역할이 자동으로 정해지진 않아요.</p>
      </div>
      <div className="flex flex-col gap-3">
        {skillCategories.map((category) => {
          const current = mySkills.get(category);
          const skillLevel = current?.skill_level ?? 0;
          const prefLevel = current?.preference_level ?? 0;
          return (
            <div key={category} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{category}</span>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs text-zinc-400">능력</span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onSetSkill(category, level === skillLevel ? 0 : level)}
                      className={`rounded-lg border px-2 py-1 text-sm transition-colors ${
                        level <= skillLevel
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                          : "border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                      }`}
                    >
                      ⭐
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs text-zinc-400">선호</span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onSetPreference(category, level === prefLevel ? 0 : level)}
                      className={`rounded-lg border px-2 py-1 text-sm transition-colors ${
                        level <= prefLevel
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                          : "border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                      }`}
                    >
                      ❤️
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function resolutionTag(resolvedBy: RoleAssignment["resolved_by"]): string | null {
  if (resolvedBy === "priority") return "🔥 우선권으로 획득";
  if (resolvedBy === "card") return "🃏 카드로 획득";
  if (resolvedBy === "duel") return "🎲 승부에서 승리";
  if (resolvedBy === "trade") return "🔄 협상으로 교환";
  return null;
}

function ConflictCard({
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
  const candidateNames = conflict.candidate_ids
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(" vs ");

  const myChoice = choices.find((c) => c.conflict_id === conflict.id && c.member_id === myMemberId);
  const iAmCandidate = myMemberId != null && conflict.candidate_ids.includes(myMemberId);

  const pendingNames = conflict.candidate_ids
    .filter((id) => !choices.find((c) => c.conflict_id === conflict.id && c.member_id === id)?.choice)
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">
        {conflict.role_label} <span className="font-normal text-zinc-400">— {candidateNames}</span>
      </p>

      {conflict.candidate_skills && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {conflict.candidate_ids.map((id) => {
            const snapshot = conflict.candidate_skills?.[id];
            if (!snapshot) return null;
            return (
              <div key={id} className="flex items-center justify-between">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {members.find((m) => m.id === id)?.name}
                </span>
                <span>
                  능력 {skillStars(snapshot.skill_level) || "–"} · 선호 {prefHearts(snapshot.preference_level) || "–"}
                </span>
              </div>
            );
          })}
        </div>
      )}

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
        <RpsSection
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

function RpsSection({
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
