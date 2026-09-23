-- supabase/schema.sql — Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행할 것.
--
-- 로그인이 없는 하루짜리 프로젝트라 RLS 정책을 의도적으로 완전히 열어 둔다(anon key로
-- 누구나 읽기/쓰기 가능). 대신 방(room)은 추측하기 어려운 랜덤 slug로만 들어올 수 있어서
-- 링크를 모르면 접근할 방법이 없다 — Google Docs의 "링크가 있는 사람" 공유와 같은 모델.

create extension if not exists pgcrypto; -- gen_random_uuid() 사용

create table rooms (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  task         text not null default '',
  round        int not null default 0,
  created_at   timestamptz not null default now(),
  -- 어떤 "문제 유형"의 방인지(src/lib/problemTypes.ts의 id). 지금은 role_assignment만
  -- 실제로 만들 수 있지만, 다른 유형이 추가돼도 rooms 테이블을 새로 안 만들어도 되게
  -- 컬럼으로 미리 열어둔다.
  problem_type text not null default 'role_assignment',
  -- 방을 만들 때 고른 상황(src/lib/situations.ts의 situation id). 참고용 정보라 선택
  -- 안 해도 그만이라 null 허용.
  situation    text,
  -- 게임 진행 단계: lobby(참가자 모으기) -> preference(1지망 선택) -> result(역할 확정).
  -- situation이 situations.ts의 프리셋과 매칭되지 않는 예전 방(단순 task 한 줄짜리)은
  -- 이 값과 무관하게 예전 화면(RoomView)을 그대로 보여준다 — 하위 호환.
  game_phase   text not null default 'lobby'
);

create table members (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references rooms(id) on delete cascade,
  name               text not null,
  last_picked_round  int not null default 0,
  created_at         timestamptz not null default now()
);

-- 뽑기 기록. member_id는 멤버가 삭제되면 null로 풀리지만(on delete set null),
-- member_name을 별도로 저장해 두어서 그 사람이 나중에 삭제돼도 기록엔 이름이 남는다.
create table draws (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  member_id   uuid references members(id) on delete set null,
  member_name text not null,
  task        text not null default '',
  round       int not null,
  created_at  timestamptz not null default now()
);

-- 역할 게임: 각자 1~3지망을 저장한다(rank 1=1지망 ... 3=3지망). situations.ts 프리셋의
-- role 문자열을 그대로 role_label에 저장한다(역할은 아직 방장이 편집하는 개념이 아니라
-- 별도 roles 테이블로 정규화하지 않음). 같은 역할을 두 지망에 중복 선택할 수 없도록
-- (room_id, member_id, role_label)도 유니크로 막는다.
create table role_preferences (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  role_label text not null,
  rank       int not null default 1,
  created_at timestamptz not null default now(),
  unique (room_id, member_id, rank),
  unique (room_id, member_id, role_label)
);

-- 역할 게임 최종 결과. assigned_rank로 "몇 지망이 반영됐는지"(비선호로 배정됐으면 null)를,
-- resolved_by로 "충돌 없이 그대로 배정됐는지 / 충돌해서 뽑기로 정해졌는지"를 구분해
-- 화면에 표시한다 — 결과가 전부 랜덤이 아니라는 걸 보여주는 지점.
create table role_assignments (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  role_label    text not null,
  member_id     uuid references members(id) on delete set null,
  member_name   text not null,
  assigned_rank int,
  resolved_by   text not null default 'preference',
  round         int not null,
  created_at    timestamptz not null default now()
);

create index members_room_id_idx on members(room_id);
create index draws_room_id_idx on draws(room_id);
create index role_preferences_room_id_idx on role_preferences(room_id);
create index role_assignments_room_id_idx on role_assignments(room_id);

alter table rooms enable row level security;
alter table members enable row level security;
alter table draws enable row level security;
alter table role_preferences enable row level security;
alter table role_assignments enable row level security;

create policy rooms_open on rooms for all using (true) with check (true);
create policy members_open on members for all using (true) with check (true);
create policy draws_open on draws for all using (true) with check (true);
create policy role_preferences_open on role_preferences for all using (true) with check (true);
create policy role_assignments_open on role_assignments for all using (true) with check (true);

-- 실시간 반영 — 같은 방을 열어둔 다른 사람 화면에 즉시 보이게 한다.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.draws;
alter publication supabase_realtime add table public.role_preferences;
alter publication supabase_realtime add table public.role_assignments;

-- ============================================================
-- draw_winner: 가중치 기반 뽑기를 원자적으로 처리하는 함수.
-- ============================================================
-- 방(room) 행을 for update로 잠가서, 같은 방에서 동시에 "뽑기"를 눌러도 라운드가
-- 꼬이지 않게 한다(ShooT 프로젝트의 feed_pet() 패턴과 동일한 이유).
--
-- 가중치 = 1 + (현재 라운드 - 그 사람이 마지막으로 뽑힌 라운드). 방금 뽑힌 사람은
-- 가중치가 가장 낮고, 오래 안 뽑힐수록 커진다. 한 번도 안 뽑힌 사람은
-- last_picked_round = 0이라 시작 시점 기준으로 동일하게 계산된다.
--
-- 가중치 비례 무작위 선택은 order by power(random(), 1.0/weight) desc limit 1로
-- 구현한다(A-ExpJ 방식의 단순화 — 가중치가 클수록 이 값이 1에 가까워져 더 자주 뽑힌다).
create or replace function draw_winner(p_room_id uuid)
returns table(winner_id uuid, winner_name text, new_round int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_task text;
  v_winner_id uuid;
  v_winner_name text;
  v_member_count int;
begin
  select round, task into v_round, v_task from rooms where id = p_room_id for update;
  if v_round is null then
    raise exception 'room_not_found';
  end if;

  select count(*) into v_member_count from members where room_id = p_room_id;
  if v_member_count < 2 then
    raise exception 'not_enough_members';
  end if;

  select m.id, m.name
    into v_winner_id, v_winner_name
    from members m
    where m.room_id = p_room_id
    order by power(random(), 1.0 / (1 + v_round - m.last_picked_round)) desc
    limit 1;

  v_round := v_round + 1;

  update rooms set round = v_round where id = p_room_id;
  update members set last_picked_round = v_round where id = v_winner_id;
  insert into draws (room_id, member_id, member_name, task, round)
    values (p_room_id, v_winner_id, v_winner_name, v_task, v_round);

  winner_id := v_winner_id;
  winner_name := v_winner_name;
  new_round := v_round;
  return next;
end;
$$;

grant execute on function draw_winner(uuid) to anon, authenticated;

-- ============================================================
-- 마이그레이션: 이미 이 스키마로 세팅된(=위 create table을 이미 실행한) 프로젝트에는
-- 위 전체를 다시 실행할 수 없다(테이블이 이미 있어서 에러). 그런 경우 이 블록만
-- SQL Editor에서 실행한다.
-- ============================================================
alter table rooms add column if not exists problem_type text not null default 'role_assignment';
alter table rooms add column if not exists situation text;
alter table rooms add column if not exists game_phase text not null default 'lobby';

create table if not exists role_preferences (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  role_label text not null,
  rank       int not null default 1,
  created_at timestamptz not null default now(),
  unique (room_id, member_id, rank)
);

create table if not exists role_assignments (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  role_label  text not null,
  member_id   uuid references members(id) on delete set null,
  member_name text not null,
  resolved_by text not null default 'preference',
  round       int not null,
  created_at  timestamptz not null default now()
);

alter table role_preferences enable row level security;
alter table role_assignments enable row level security;
create policy role_preferences_open on role_preferences for all using (true) with check (true);
create policy role_assignments_open on role_assignments for all using (true) with check (true);
alter publication supabase_realtime add table public.role_preferences;
alter publication supabase_realtime add table public.role_assignments;

-- ============================================================
-- 마이그레이션 2: 1인 1지망 -> 1~3지망으로 확장하면서 추가된 부분.
-- role_preferences/role_assignments를 이미 위 마이그레이션 1로 만들어 둔 프로젝트는
-- 이 블록만 SQL Editor에서 실행한다.
-- ============================================================
alter table role_preferences add constraint role_preferences_room_member_role_key unique (room_id, member_id, role_label);
alter table role_assignments add column if not exists assigned_rank int;
