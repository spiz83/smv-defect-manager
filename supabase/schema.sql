-- ============================================================================
--  SMV / DefFixer  —  Central Database Schema (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
--  Multi-app, multi-tenant foundation.
--
--  SHARED layer  (profiles, workspaces, workspace_members)
--      -> reused by EVERY app you build (DefFixer, CH Tracker, ...).
--      -> one login, one set of teams, shared across apps.
--
--  APP layer  (tables prefixed per app, e.g. dm_ = Defect Manager)
--      -> CH Tracker will later add ch_* tables that reuse the SAME
--         workspaces + logins, so data can be merged / cross-referenced.
--
--  Every app row is scoped by workspace_id and protected by Row Level
--  Security so users only ever see data for workspaces they belong to.
--
--  HOW TO RUN:  Supabase Dashboard -> SQL Editor -> New query ->
--               paste this whole file -> Run.  Safe to re-run (idempotent).
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ============================================================================
--  SHARED LAYER  (cross-app: identity + teams)
-- ============================================================================

-- One row per authenticated user (mirrors auth.users).
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text,
    full_name   text,
    created_at  timestamptz not null default now()
);

-- A workspace = a team / organisation. Data lives under a workspace, not a user,
-- so multiple people can collaborate and ownership can be transferred.
create table if not exists public.workspaces (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    owner_id    uuid not null references auth.users (id),
    created_at  timestamptz not null default now()
);

-- Membership: which users belong to which workspace, and their role.
create table if not exists public.workspace_members (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    user_id      uuid not null references auth.users (id) on delete cascade,
    role         text not null default 'member'
                 check (role in ('owner', 'admin', 'member')),
    created_at   timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

-- Helper: is the current user a member of this workspace?
-- SECURITY DEFINER so it can read membership without tripping its own RLS.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.workspace_members m
        where m.workspace_id = ws and m.user_id = auth.uid()
    );
$$;

-- ============================================================================
--  APP LAYER  —  DEFECT MANAGER  (prefix: dm_)
-- ============================================================================

-- Defect lifecycle:  open -> pending -> completed
do $$ begin
    create type public.dm_defect_status as enum ('open', 'pending', 'completed');
exception when duplicate_object then null; end $$;

-- Trades / cost codes  (app legacy ids preserved in legacy_id for migration)
create table if not exists public.dm_trades (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    legacy_id    integer,
    name         text not null,
    code         text,
    created_at   timestamptz not null default now()
);

-- Contractors
create table if not exists public.dm_contractors (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    legacy_id    integer,
    name         text not null,
    email        text,
    phone        text,
    created_at   timestamptz not null default now()
);

-- Contractor <-> Trade  (many-to-many; replaces the tradeIds array)
create table if not exists public.dm_contractor_trades (
    contractor_id uuid not null references public.dm_contractors (id) on delete cascade,
    trade_id      uuid not null references public.dm_trades (id) on delete cascade,
    primary key (contractor_id, trade_id)
);

-- Addresses / properties
create table if not exists public.dm_addresses (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces (id) on delete cascade,
    legacy_id       integer,
    street          text,
    suburb          text,
    property_number text,
    created_at      timestamptz not null default now()
);

-- Defects  (the core record)
create table if not exists public.dm_defects (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces (id) on delete cascade,
    legacy_id       integer,
    address_id      uuid references public.dm_addresses (id) on delete cascade,
    contractor_id   uuid references public.dm_contractors (id) on delete set null,
    trade_id        uuid references public.dm_trades (id) on delete set null,
    description     text not null,
    status          public.dm_defect_status not null default 'open',

    -- #3 AI import: items stay unassigned until a trade is chosen
    unassigned      boolean not null default false,

    -- #6 Contractor communication tracking (audit trail)
    last_email_at   timestamptz,
    last_sms_at     timestamptz,
    last_update_at  timestamptz,
    followup_at     timestamptz,

    completed_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- #4 Defect photos (files live in Supabase Storage; this tracks metadata)
create table if not exists public.dm_defect_photos (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces (id) on delete cascade,
    defect_id     uuid not null references public.dm_defects (id) on delete cascade,
    storage_path  text not null,            -- path within the 'defect-photos' bucket
    bytes         integer,                  -- enforced <= 500 KB client-side
    created_at    timestamptz not null default now(),
    -- auto-expire 30 days after upload (swept on login / after changes)
    expires_at    timestamptz not null default (now() + interval '30 days')
);

-- Helpful indexes
create index if not exists dm_defects_ws_idx        on public.dm_defects (workspace_id);
create index if not exists dm_defects_address_idx   on public.dm_defects (address_id);
create index if not exists dm_defects_contractor_idx on public.dm_defects (contractor_id);
create index if not exists dm_defects_status_idx    on public.dm_defects (status);
create index if not exists dm_photos_defect_idx     on public.dm_defect_photos (defect_id);
create index if not exists dm_photos_expires_idx    on public.dm_defect_photos (expires_at);

-- Keep updated_at fresh + stamp completed_at when status flips to completed.
create or replace function public.dm_defects_touch()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    if new.status = 'completed' and (old.status is distinct from 'completed') then
        new.completed_at := now();
    elsif new.status <> 'completed' then
        new.completed_at := null;
    end if;
    return new;
end $$;

drop trigger if exists dm_defects_touch_trg on public.dm_defects;
create trigger dm_defects_touch_trg
    before update on public.dm_defects
    for each row execute function public.dm_defects_touch();

-- ============================================================================
--  ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.dm_trades           enable row level security;
alter table public.dm_contractors      enable row level security;
alter table public.dm_contractor_trades enable row level security;
alter table public.dm_addresses        enable row level security;
alter table public.dm_defects          enable row level security;
alter table public.dm_defect_photos    enable row level security;

-- profiles: a user can see/edit only their own profile row
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
    for all using (id = auth.uid()) with check (id = auth.uid());

-- workspaces: members can read; owner can update/delete; any signed-in user can create
drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces
    for select using (public.is_workspace_member(id) or owner_id = auth.uid());
drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
    for insert with check (owner_id = auth.uid());
drop policy if exists workspaces_modify on public.workspaces;
create policy workspaces_modify on public.workspaces
    for update using (owner_id = auth.uid());
drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
    for delete using (owner_id = auth.uid());

-- workspace_members: members can read the roster; you can always read your own row
drop policy if exists members_read on public.workspace_members;
create policy members_read on public.workspace_members
    for select using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
-- (invite/role management is handled server-side later; kept tight for now)
drop policy if exists members_self_insert on public.workspace_members;
create policy members_self_insert on public.workspace_members
    for insert with check (
        user_id = auth.uid()
        and exists (select 1 from public.workspaces w
                    where w.id = workspace_id and w.owner_id = auth.uid())
    );

-- Generic membership-based policy for every dm_* app table.
do $$
declare t text;
begin
    foreach t in array array[
        'dm_trades','dm_contractors','dm_addresses','dm_defects','dm_defect_photos'
    ] loop
        execute format('drop policy if exists %1$s_member on public.%1$s;', t);
        execute format($f$
            create policy %1$s_member on public.%1$s
            for all
            using (public.is_workspace_member(workspace_id))
            with check (public.is_workspace_member(workspace_id));
        $f$, t);
    end loop;
end $$;

-- contractor_trades has no workspace_id of its own; gate via its contractor
drop policy if exists dm_contractor_trades_member on public.dm_contractor_trades;
create policy dm_contractor_trades_member on public.dm_contractor_trades
    for all using (exists (
        select 1 from public.dm_contractors c
        where c.id = contractor_id and public.is_workspace_member(c.workspace_id)
    )) with check (exists (
        select 1 from public.dm_contractors c
        where c.id = contractor_id and public.is_workspace_member(c.workspace_id)
    ));

-- ============================================================================
--  AUTO-PROVISION: on signup, create a profile + a personal workspace
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
    on conflict (id) do nothing;

    insert into public.workspaces (name, owner_id)
    values (coalesce(new.raw_user_meta_data->>'full_name', 'My Workspace'), new.id)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'owner');

    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
--  DONE.  Next: create a Storage bucket named 'defect-photos' (private) for #4.
-- ============================================================================
