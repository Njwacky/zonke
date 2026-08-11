-- ============================================================================
-- ZONKE - Supabase setup for the `zonkedb` player registry table
-- ============================================================================
-- Run this in the Supabase Dashboard:  SQL Editor -> New query -> Run
--
-- The browser game (game.js -> ZonkeSupabase.registerPlayer) writes directly
-- to this table through PostgREST using the publishable anon key, exactly the
-- same way the `profiles` and `friends` tables already work.
-- THE NODE SERVER DOES NOT NEED THIS TABLE. No server-side code required.
-- ============================================================================

-- 1. Create the table (skip if you already created it in the Table Editor):
create table if not exists public.zonkedb (
    id         bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    player01   text
);

-- 2. (Recommended) One row per player -> prevents duplicate registrations
--    race-free at the database level, and turns a re-insert into a clean 409:
create unique index if not exists zonkedb_player01_unique
    on public.zonkedb (player01);

-- 3. Enable Row Level Security (IMPORTANT - otherwise the public anon key can
--    UPDATE and DELETE the whole table, not just insert into it):
alter table public.zonkedb enable row level security;

-- 4. Policies: the game only ever needs to READ and INSERT rows.
--    No UPDATE / DELETE policies = nobody can edit or wipe the registry
--    with the anon key.
drop policy if exists "anon can read players"    on public.zonkedb;
drop policy if exists "anon can register players" on public.zonkedb;

create policy "anon can read players"
    on public.zonkedb for select
    to anon using (true);

create policy "anon can register players"
    on public.zonkedb for insert
    to anon with check (true);

-- 5. Sanity checks:
--    select * from public.zonkedb order by created_at desc limit 20;
--    select count(distinct player01) as registered_players from public.zonkedb;
