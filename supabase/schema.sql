-- Supabase 대시보드 → SQL Editor 에서 한 번 실행
-- 테이블: 앱 전체 상태를 JSON 한 덩어리로 저장 (기존 localStorage 키 jangbak-v8 와 동일 개념)

create table if not exists public.jangbak_app_data (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- 선택: updated_at 자동 갱신
-- create extension if not exists moddatetime schema extensions;
-- (Supabase 기본에 따라 다를 수 있음 — 필요 시 대시보드에서 트리거 추가)

alter table public.jangbak_app_data enable row level security;

-- ⚠️ 개발/내부용: 익명(anon) 키로 누구나 읽기·쓰기 가능.
-- 배포 전에는 Supabase Auth + 사용자별 RLS 정책으로 반드시 교체하세요.
create policy "jangbak_allow_anon_select"
  on public.jangbak_app_data for select
  using (true);

create policy "jangbak_allow_anon_insert"
  on public.jangbak_app_data for insert
  with check (true);

create policy "jangbak_allow_anon_update"
  on public.jangbak_app_data for update
  using (true)
  with check (true);
