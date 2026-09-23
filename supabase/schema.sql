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
  -- 게임 진행 단계: lobby(참가자 모으기) -> preference(지망 선택) -> conflict(충돌 해결
  -- 중) -> result(역할 확정). situation이 situations.ts의 프리셋과 매칭되지 않는 예전
  -- 방(단순 task 한 줄짜리)은 이 값과 무관하게 예전 화면(RoomView)을 그대로 보여준다.
  game_phase   text not null default 'lobby',
  -- 지금 진행 중인 라운드에서 몇 지망까지 처리했는지(충돌 해결이 여러 지망에 걸쳐
  -- 진행되므로 서버가 "다음엔 몇 지망을 볼 차례인지" 기억해야 한다).
  conflict_rank int not null default 0,
  -- "다음 지망으로 넘어가는 중" 락. 서로 다른 두 충돌이 거의 동시에 끝나면 두 요청이
  -- 동시에 다음 단계로 넘어가려다 결과가 중복 생성될 수 있어서, 이 값으로 한 번에
  -- 하나의 요청만 넘어가게 막는다(processNextRank 참고).
  advancing     boolean not null default false,
  -- 이번 게임(라운드)에서 실제로 쓰기로 고른 역할들 — situations.ts의 추천 역할 + 이
  -- 방에서 만든 커스텀 역할(custom_roles) 중 체크된 것들의 이름 스냅샷. null/빈 배열이면
  -- 아직 한 번도 고른 적 없는 방이라 추천 역할 전체를 기본값으로 쓴다(하위 호환).
  active_roles  text[]
);

create table members (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references rooms(id) on delete cascade,
  name                 text not null,
  last_picked_round    int not null default 0,
  created_at           timestamptz not null default now(),
  -- 역할 충돌 시 쓸 수 있는 우선권. 게임(라운드)마다 1개씩 새로 주어지고, 한 번 쓰면
  -- 그 라운드 동안은 다시 못 쓴다(restartRound에서 초기화됨).
  priority_token_used  boolean not null default false,
  -- 🃏 카드 — 우선권보다는 약하지만 승부보다는 강한 새 충돌 해결 수단. 우선권과
  -- 마찬가지로 라운드마다 1개, 안 그러면 승부(가위바위보)를 고를 이유가 없어진다.
  card_token_used      boolean not null default false
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
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  role_label       text not null,
  member_id        uuid references members(id) on delete set null,
  member_name      text not null,
  assigned_rank    int,
  resolved_by      text not null default 'preference',
  round            int not null,
  created_at       timestamptz not null default now(),
  -- 이 역할에 연결된 능력이 있으면, 배정된 사람의 그 능력/선호 값을 배정 시점에 그대로
  -- 복사해 둔다(스냅샷) — 나중에 player_skills를 고쳐도 이 기록은 안 바뀐다. 연결된
  -- 능력이 없는 역할이면 둘 다 null.
  skill_level      int,
  preference_level int,
  -- 이 라운드가 어떤 주제(rooms.problem_type)로 진행됐는지 스냅샷. 방은 "🔀 주제
  -- 바꾸기"로 나중에 problem_type이 바뀔 수 있어서, rooms.problem_type을 그때그때
  -- 조회하면 지난 기록이 지금 주제로 잘못 보인다 — 기록 화면(📋)은 항상 이 값을 쓴다.
  game_type        text
);

-- 같은 지망 단계에서 역할 하나에 2명 이상 몰리면 생기는 "충돌" 하나. candidate_ids는
-- 그 역할을 이 지망으로 고른 사람 전원, finalist_ids는 우선권/양보/승부 1단계를 거쳐
-- 가위바위보까지 가야 하는 사람만 남긴 좁혀진 목록(2단계 전엔 null).
create table role_conflicts (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  round            int not null,
  rank             int not null,
  role_label       text not null,
  candidate_ids    uuid[] not null,
  finalist_ids     uuid[],
  status           text not null default 'choosing', -- 'choosing' | 'rps' | 'resolved'
  winner_id        uuid references members(id) on delete set null,
  winner_reason    text, -- 'priority' | 'duel' | 'draw'
  created_at       timestamptz not null default now(),
  -- 충돌이 생기는 시점의 후보별 능력/선호 스냅샷: {"<member_id>": {"skill_level": n,
  -- "preference_level": n}, ...}. 충돌 카드에 "철수 능력⭐⭐⭐/선호❤️❤️" 식으로
  -- 보여주는 정보이자, 이후 player_skills가 바뀌어도 이 충돌엔 영향 없게 하는 스냅샷.
  candidate_skills jsonb
);

-- 충돌 참가자 각자의 선택. choice는 1단계(우선권/양보/승부), rps_move는 2단계(가위바위보)
-- — 둘 다 같은 행에 저장해서 "이 사람이 이 충돌에서 뭘 했는지"를 한 줄로 추적한다.
-- room_id는 role_conflicts로도 알 수 있지만, Realtime 구독 필터(room_id=eq.…)를 걸려면
-- 이 테이블에도 있어야 해서 그대로 중복 저장한다.
create table role_conflict_choices (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  conflict_id uuid not null references role_conflicts(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  choice      text, -- 'priority' | 'concede' | 'duel'
  rps_move    text, -- 'rock' | 'paper' | 'scissors'
  created_at  timestamptz not null default now(),
  unique (conflict_id, member_id)
);

-- 사용자가 직접 만든 역할("내 역할"). situations.ts의 고정 role 문자열은 그대로
-- "추천 역할"로 남고, 이 테이블은 그 위에 방마다 자유롭게 추가하는 역할을 담는다.
-- 지금은 room_id로만 스코프해서 "이 방에서만" 쓰지만(스펙 8번), 나중에 여러 방에서
-- 재사용하려면 room_id 대신/추가로 situation_id 기준 조회를 얹으면 된다.
--
-- RLS가 완전히 열려 있어 누구나 행을 고칠 수는 있지만, "만든 사람만 수정/삭제" 권한은
-- DB가 아니라 서버 액션(updateCustomRole/deleteCustomRole)에서 created_by를 대조해서
-- 지킨다 — 이 프로젝트 전체가 원래 그런 신뢰 모델이다(RLS는 링크 접근 통제용).
--
-- 과거 게임 결과(role_assignments)는 role_label을 문자열로 그대로 저장하지 이 테이블을
-- 참조하지 않으므로, 커스텀 역할을 나중에 지워도 지난 기록의 역할 이름은 안 깨진다.
create table custom_roles (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references rooms(id) on delete cascade,
  name           text not null,
  description    text,
  created_by     uuid references members(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 이 역할과 연결된 능력 카테고리(situations.ts의 skills 중 하나, 또는 null=연결 안 함).
  skill_category text
);

-- 플레이어가 스스로 매기는 능력/선호. situations.ts의 상황마다 다른 능력 카테고리를
-- 쓰고(예: 팀플="발표", 집안일="설거지"), 레벨은 0(미설정)~3의 단순한 3단계다.
-- 이건 "지금 이 사람의 프로필"이라 게임 중에도 자유롭게 고칠 수 있는 값이고, 이미
-- 끝난 게임 기록은 이 값을 실시간으로 참조하지 않는다 — 충돌/결과가 만들어지는 순간의
-- 값을 role_conflicts.candidate_skills / role_assignments.skill_level 등에 그대로
-- 복사해 두기 때문에(스펙 10번 "게임 세션별 스냅샷"), 나중에 프로필을 바꿔도 지난
-- 기록은 안 변한다.
create table player_skills (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  member_id        uuid not null references members(id) on delete cascade,
  skill_category   text not null,
  skill_level      int not null default 0,
  preference_level int not null default 0,
  updated_at       timestamptz not null default now(),
  unique (room_id, member_id, skill_category)
);

-- 결과가 나온 뒤 "내 역할이랑 바꾸자" 제안/수락. 라운드별로 스코프해서 다음 라운드로
-- 넘어가면(restartRound) 자동으로 정리된다. 수락되면 role_assignments 두 행의
-- role_label(+그 역할에 맞는 능력 스냅샷)을 서로 바꾼다 — 사람이 바뀌는 게 아니라
-- 같은 라운드 안에서 역할만 맞바꾸는 것이라 별도 배정 이력을 새로 만들지 않는다.
create table role_swap_proposals (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  round       int not null,
  proposer_id uuid not null references members(id) on delete cascade,
  target_id   uuid not null references members(id) on delete cascade,
  status      text not null default 'pending', -- 'pending' | 'accepted' | 'declined'
  created_at  timestamptz not null default now()
);

create index members_room_id_idx on members(room_id);
create index draws_room_id_idx on draws(room_id);
create index role_preferences_room_id_idx on role_preferences(room_id);
create index role_assignments_room_id_idx on role_assignments(room_id);
create index role_conflicts_room_id_idx on role_conflicts(room_id);
create index role_conflict_choices_conflict_id_idx on role_conflict_choices(conflict_id);
create index role_conflict_choices_room_id_idx on role_conflict_choices(room_id);
create index custom_roles_room_id_idx on custom_roles(room_id);
create index player_skills_room_id_idx on player_skills(room_id);
create index role_swap_proposals_room_id_idx on role_swap_proposals(room_id);

alter table rooms enable row level security;
alter table members enable row level security;
alter table draws enable row level security;
alter table role_preferences enable row level security;
alter table role_assignments enable row level security;
alter table role_conflicts enable row level security;
alter table role_conflict_choices enable row level security;
alter table custom_roles enable row level security;
alter table player_skills enable row level security;
alter table role_swap_proposals enable row level security;

create policy rooms_open on rooms for all using (true) with check (true);
create policy members_open on members for all using (true) with check (true);
create policy draws_open on draws for all using (true) with check (true);
create policy role_preferences_open on role_preferences for all using (true) with check (true);
create policy role_assignments_open on role_assignments for all using (true) with check (true);
create policy role_conflicts_open on role_conflicts for all using (true) with check (true);
create policy role_conflict_choices_open on role_conflict_choices for all using (true) with check (true);
create policy custom_roles_open on custom_roles for all using (true) with check (true);
create policy player_skills_open on player_skills for all using (true) with check (true);
create policy role_swap_proposals_open on role_swap_proposals for all using (true) with check (true);

-- 실시간 반영 — 같은 방을 열어둔 다른 사람 화면에 즉시 보이게 한다.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.draws;
alter publication supabase_realtime add table public.role_preferences;
alter publication supabase_realtime add table public.role_assignments;
alter publication supabase_realtime add table public.role_conflicts;
alter publication supabase_realtime add table public.role_conflict_choices;
alter publication supabase_realtime add table public.custom_roles;
alter publication supabase_realtime add table public.role_swap_proposals;
alter publication supabase_realtime add table public.player_skills;

-- 기본 REPLICA IDENTITY(기본키만)로는 DELETE된 행의 room_id를 알 수 없어서, room_id로
-- 거는 postgres_changes 필터(위 클라이언트 구독 전부가 이 패턴)가 DELETE 이벤트에 대해
-- 아예 매치되지 않고 조용히 씹힌다 — "나가기"로 나간 참가자가 다른 사람 화면에서 안
-- 사라지고, 커스텀 역할을 지워도 다른 화면에 안 지워지는 게 이 문제였다. DELETE가
-- realtime으로 반영돼야 하는 테이블은 FULL로 바꿔서 지워진 행 전체를 실어 보내게 한다.
alter table members replica identity full;
alter table role_preferences replica identity full;
alter table role_conflicts replica identity full;
alter table role_conflict_choices replica identity full;
alter table custom_roles replica identity full;
alter table player_skills replica identity full;
alter table role_swap_proposals replica identity full;

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

-- ============================================================
-- 마이그레이션 3: 충돌 해결 게임(우선권/양보/승부 + 가위바위보) 추가.
-- ============================================================
alter table rooms add column if not exists conflict_rank int not null default 0;
alter table members add column if not exists priority_token_used boolean not null default false;

create table if not exists role_conflicts (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  round         int not null,
  rank          int not null,
  role_label    text not null,
  candidate_ids uuid[] not null,
  finalist_ids  uuid[],
  status        text not null default 'choosing',
  winner_id     uuid references members(id) on delete set null,
  winner_reason text,
  created_at    timestamptz not null default now()
);

create table if not exists role_conflict_choices (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  conflict_id uuid not null references role_conflicts(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  choice      text,
  rps_move    text,
  created_at  timestamptz not null default now(),
  unique (conflict_id, member_id)
);

create index if not exists role_conflicts_room_id_idx on role_conflicts(room_id);
create index if not exists role_conflict_choices_conflict_id_idx on role_conflict_choices(conflict_id);

alter table role_conflicts enable row level security;
alter table role_conflict_choices enable row level security;
create policy role_conflicts_open on role_conflicts for all using (true) with check (true);
create policy role_conflict_choices_open on role_conflict_choices for all using (true) with check (true);
alter publication supabase_realtime add table public.role_conflicts;
alter publication supabase_realtime add table public.role_conflict_choices;

-- ============================================================
-- 마이그레이션 3 추가분: 두 충돌이 거의 동시에 끝날 때 결과가 중복 생성되던 레이스
-- 컨디션을 막기 위한 락 컬럼. 마이그레이션 3을 이미 실행한 프로젝트는 이 줄만 실행한다.
-- ============================================================
alter table rooms add column if not exists advancing boolean not null default false;

-- ============================================================
-- 마이그레이션 4: 역할 관리(추천/커스텀 역할, 게임별 역할 선택) + 게임 기록.
-- 기록 자체는 이미 남아있던 role_assignments를 라운드별로 묶어 보여주는 것뿐이라
-- 새 테이블이 필요 없고, custom_roles 테이블 하나와 rooms.active_roles 컬럼만 추가한다.
-- ============================================================
alter table rooms add column if not exists active_roles text[];

create table if not exists custom_roles (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists custom_roles_room_id_idx on custom_roles(room_id);
alter table custom_roles enable row level security;
create policy custom_roles_open on custom_roles for all using (true) with check (true);
alter publication supabase_realtime add table public.custom_roles;

-- ============================================================
-- 마이그레이션 5: DELETE realtime 필터 버그 수정.
-- 기본 REPLICA IDENTITY(기본키만)로는 삭제된 행의 room_id가 안 실려서, room_id로 거는
-- postgres_changes 필터(클라이언트 구독 전부가 이 패턴)가 DELETE에 대해 매치되지 않고
-- 조용히 씹힌다 — "나가기"로 나간 참가자가 다른 사람 화면에서 안 사라지고, 커스텀
-- 역할을 지워도 다른 화면엔 안 지워지는 원인이었다(실제로 테스트하다 발견).
-- ============================================================
alter table members replica identity full;
alter table role_preferences replica identity full;
alter table role_conflicts replica identity full;
alter table role_conflict_choices replica identity full;
alter table custom_roles replica identity full;

-- ============================================================
-- 마이그레이션 6: 플레이어 능력/선호 시스템.
-- 능력/선호는 결과를 자동으로 정하지 않는다 — 충돌 카드와 결과 화면에 "참고 정보"로만
-- 보여주고, 실제 결정은 여전히 우선권/양보/승부(+가위바위보)가 한다.
-- ============================================================
alter table custom_roles add column if not exists skill_category text;
alter table role_conflicts add column if not exists candidate_skills jsonb;
alter table role_assignments add column if not exists skill_level int;
alter table role_assignments add column if not exists preference_level int;

create table if not exists player_skills (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  member_id        uuid not null references members(id) on delete cascade,
  skill_category   text not null,
  skill_level      int not null default 0,
  preference_level int not null default 0,
  updated_at       timestamptz not null default now(),
  unique (room_id, member_id, skill_category)
);

create index if not exists player_skills_room_id_idx on player_skills(room_id);
alter table player_skills enable row level security;
create policy player_skills_open on player_skills for all using (true) with check (true);
alter publication supabase_realtime add table public.player_skills;
alter table player_skills replica identity full;

-- ============================================================
-- 마이그레이션 7: 새 충돌 해결 액션(🃏 카드) + 결과 확정 후 역할 교환 협상.
-- 카드는 resolved_by에 새 값 'card'가 추가되는 것뿐이라 role_assignments 스키마
-- 변경은 없다(원래 자유 텍스트 컬럼). 교환은 role_swap_proposals 테이블 하나로 처리.
-- ============================================================
alter table members add column if not exists card_token_used boolean not null default false;

create table if not exists role_swap_proposals (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  round       int not null,
  proposer_id uuid not null references members(id) on delete cascade,
  target_id   uuid not null references members(id) on delete cascade,
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);

create index if not exists role_swap_proposals_room_id_idx on role_swap_proposals(room_id);
alter table role_swap_proposals enable row level security;
create policy role_swap_proposals_open on role_swap_proposals for all using (true) with check (true);
alter publication supabase_realtime add table public.role_swap_proposals;
alter table role_swap_proposals replica identity full;

-- ============================================================
-- 마이그레이션 8: 🔀 주제 바꾸기 — 같은 방·참가자를 유지한 채 rooms.problem_type/
-- situation만 바꿔서 새 게임 주제로 넘어간다("다시 하기"와 달리 주제 자체가 바뀐다).
-- role_assignments.game_type은 그 라운드가 어떤 주제였는지 기록해서, 주제를 여러 번
-- 바꾼 방의 📋 기록 화면이 지난 라운드를 지금 주제가 아니라 그때 주제로 보여주게 한다.
-- ============================================================
alter table role_assignments add column if not exists game_type text;
