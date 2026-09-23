// src/lib/slug.ts — 방(room) 링크에 쓰는 짧은 랜덤 문자열 생성.
// 추측하기 어렵게 하는 게 목적이라(별도 인증이 없으므로 이게 유일한 접근 장벽) 충분히
// 넓은 문자 집합과 길이를 쓴다. 0/O, 1/l처럼 헷갈리는 문자는 빼서 direct 타이핑도 가능하게 했다.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

export function generateSlug(length = 8): string {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
