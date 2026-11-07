-- Apply in the Supabase SQL editor. Auth users own exactly one private planner document.
create table if not exists public.student_planner_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_planner_data enable row level security;
alter table public.student_planner_data force row level security;

revoke all on public.student_planner_data from anon;
grant select, insert, update on public.student_planner_data to authenticated;

drop policy if exists "Students can read their own planner" on public.student_planner_data;
create policy "Students can read their own planner"
  on public.student_planner_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Students can create their own planner" on public.student_planner_data;
create policy "Students can create their own planner"
  on public.student_planner_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Students can update their own planner" on public.student_planner_data;
create policy "Students can update their own planner"
  on public.student_planner_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
