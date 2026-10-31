create table if not exists public.aerock_practices (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 title text not null check(length(title) between 1 and 120),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default '조율 중' check(status in ('조율 중','예약 대기','예약 완료','취소')),
 location text not null default '',
 rooms text not null default '',
 song_ids jsonb not null default '[]',
 rundown text not null default '',
 notes text not null default '',
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at),check(jsonb_typeof(song_ids)='array')
);
alter table public.aerock_practices enable row level security;
create policy practice_read on public.aerock_practices for select to authenticated using(public.aerock_active());
create policy practice_insert on public.aerock_practices for insert to authenticated with check(public.aerock_active() and owner_id=auth.uid() and status in ('조율 중','예약 대기'));
create policy practice_update on public.aerock_practices for update to authenticated using(public.aerock_active() and (owner_id=auth.uid() or exists(select 1 from public.member_profiles where id=auth.uid() and role in ('president','vicepresident','leader1','leader2','leader3')))) with check(public.aerock_active() and (owner_id=auth.uid() or exists(select 1 from public.member_profiles where id=auth.uid() and role in ('president','vicepresident','leader1','leader2','leader3'))));
grant select,insert,update on public.aerock_practices to authenticated;
