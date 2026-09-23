"use server";
// src/app/actions.ts — 이 파일의 함수들은 서버에서만 실행된다(클라이언트 번들에 코드가
// 포함되지 않는다). 뽑기의 실제 결과(draw_winner RPC 호출)도 여기서만 일어나므로,
// 브라우저에서 결과를 조작할 방법이 없다 — 클라이언트는 "뽑아줘" 요청만 보내고 서버가
// 계산한 결과를 그대로 받는다.
import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { generateSlug } from "@/lib/slug";

export async function createRoom(formData: FormData) {
  const task = String(formData.get("task") ?? "").trim().slice(0, 30);
  // 문제 유형/상황 선택 단계(홈 화면 위저드)에서 넘어온 값. 아직 그 단계를 거치지 않고
  // 호출되더라도 기존처럼 동작하도록 기본값을 둔다.
  const problemType = String(formData.get("problem_type") ?? "role_assignment").trim().slice(0, 30);
  const situation = String(formData.get("situation") ?? "").trim().slice(0, 30) || null;
  const supabase = getSupabase();

  // slug 충돌은 극히 드물지만(8자, 53진법) 방어적으로 몇 번 재시도한다.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    const { error } = await supabase
      .from("rooms")
      .insert({ slug, task, problem_type: problemType, situation });
    if (!error) redirect(`/r/${slug}`);
    // unique 위반(23505)이면 다른 slug로 재시도, 그 외 에러는 바로 던진다.
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("방을 만들지 못했어요. 다시 시도해주세요.");
}

export async function addMember(roomId: string, name: string) {
  const trimmed = name.trim().slice(0, 12);
  if (!trimmed) return { ok: false as const, error: "이름을 입력해주세요" };

  const supabase = getSupabase();
  const { error } = await supabase.from("members").insert({ room_id: roomId, name: trimmed });
  if (error) return { ok: false as const, error: "이미 있는 이름이거나 저장에 실패했어요" };
  return { ok: true as const };
}

export async function removeMember(memberId: string) {
  const supabase = getSupabase();
  await supabase.from("members").delete().eq("id", memberId);
}

export async function updateTask(roomId: string, task: string) {
  const supabase = getSupabase();
  await supabase.from("rooms").update({ task: task.slice(0, 30) }).eq("id", roomId);
}

export async function drawWinner(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("draw_winner", { p_room_id: roomId }).maybeSingle();
  if (error) {
    if (error.message.includes("not_enough_members")) {
      return { ok: false as const, error: "참가자가 2명 이상 필요해요" };
    }
    return { ok: false as const, error: "뽑기에 실패했어요. 다시 시도해주세요" };
  }
  const winner = data as { winner_name: string };
  return { ok: true as const, winnerName: winner.winner_name };
}
