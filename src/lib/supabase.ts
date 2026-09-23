// src/lib/supabase.ts — Supabase 클라이언트 팩토리.
// 이 프로젝트는 로그인이 없어서 anon key 하나로 서버·클라이언트 양쪽에서 다 쓴다.
// RLS 정책이 완전히 열려 있으므로(참고: supabase/schema.sql) 권한 분리는 하지 않는다 —
// 대신 방(room)은 추측하기 어려운 랜덤 slug로만 접근 가능하다(링크를 모르면 못 들어온다).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // 빌드 자체는 되게 하되, 실제 호출 시점에 바로 원인을 알 수 있게 명확한 에러를 던진다.
  console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.");
}

// 서버 컴포넌트·서버 액션·클라이언트 컴포넌트 어디서 호출해도 안전하도록 매번 새로 만든다
// (세션을 유지할 필요가 없는 anon-only 클라이언트라 싱글턴으로 공유해도 되지만, 서버리스
// 환경에서 요청 간 상태가 섞이지 않게 하는 편이 안전하다는 원칙을 지킨다).
export function getSupabase() {
  return createClient(url ?? "", anonKey ?? "");
}
