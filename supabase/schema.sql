-- supabase/schema.sql — Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행할 것.
--
-- 로그인이 없는 하루짜리 프로젝트라 RLS 정책을 의도적으로 완전히 열어 둔다(anon key로
-- 누구나 읽기/쓰기 가능). 대신 방(room)은 추측하기 어려운 랜덤 slug로만 들어올 수 있어서
-- 링크를 모르면 접근할 방법이 없다 — Google Docs의 "링크가 있는 사람" 공유와 같은 모델.

create extension if not exists pgcrypto; -- gen_random_uuid() 사용

create table rooms (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  task       text not null default '',
  round      int not null default 0,
  created_at timestamptz not null default now()
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

create index members_room_id_idx on members(room_id);
create index draws_room_id_idx on draws(room_id);

alter table rooms enable row level security;
alter table members enable row level security;
alter table draws enable row level security;

create policy rooms_open on rooms for all using (true) with check (true);
create policy members_open on members for all using (true) with check (true);
create policy draws_open on draws for all using (true) with check (true);

-- 실시간 반영 — 같은 방을 열어둔 다른 사람 화면에 즉시 보이게 한다.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.draws;

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
