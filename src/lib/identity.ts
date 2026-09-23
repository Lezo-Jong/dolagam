// src/lib/identity.ts — 로그인이 없는 앱에서 "이 브라우저가 방 안의 누구인지"를 기억하는
// 최소한의 장치. 서버는 이 값을 신뢰하지 않는다(참가자 목록에 실제로 있는 member_id인지
// 항상 대조) — 그냥 매번 이름을 다시 입력하지 않아도 되게 해주는 편의 기능일 뿐이다.

const key = (roomId: string) => `dolagamyeo:${roomId}:memberId`;

export function getMyMemberId(roomId: string): string | null {
  try {
    return localStorage.getItem(key(roomId));
  } catch {
    return null;
  }
}

export function setMyMemberId(roomId: string, memberId: string) {
  try {
    localStorage.setItem(key(roomId), memberId);
  } catch {
    // 저장 실패해도 치명적이지 않다 — 다음에 다시 이름을 입력하면 된다.
  }
}

// "나가기" — 이 브라우저가 기억하던 정체성을 지운다. 다시 들어오면 이름을 새로 입력해야 한다.
export function clearMyMemberId(roomId: string) {
  try {
    localStorage.removeItem(key(roomId));
  } catch {
    // 무시해도 된다 — 어차피 페이지를 벗어난다.
  }
}
