-- ============================================================================
--  Shared contractor memory  —  2026-11-20   (Phase 2)
-- ----------------------------------------------------------------------------
--  WHY (Spiro, 2026-11-19): "this is the whole of it, so it predicts and
--  reduces the guess work from the supervisor… keeping a log / database to
--  LEARN as you go… BUT MEMORY IS VERY IMPORTANT."
--
--  Two things learn in the Defect Manager, and only one of them was durable:
--
--    · phrase -> TRADE lives in dm_trade_learning: server-side, shared by every
--      supervisor, role-weighted, permanent. Phase 1 (build 2026-11-19l) also
--      taught it to answer on SIMILAR wording instead of word-for-word repeats.
--
--    · phrase -> CONTRACTOR — the 🧠 "learned ×N" suggestions, the ones that
--      actually name a sub — was rebuilt on each phone from the defects that
--      phone could read. Nothing was shared between supervisors, nothing
--      survived a device being reset, and until 2026-11-19k completing a job
--      erased everything it had taught.
--
--  This table is the second half: the same durable, shared memory for the
--  contractor side. One row per (token, contractor), carrying a weight.
--
--  WHAT IT IS NOT: it is not a copy of the defects. It holds single words and
--  tallies — "trough: Seal Tight Caulking, w=7" — so nothing in it identifies a
--  job, a house or a person, and a supervisor reading it learns nothing they
--  could not learn by doing their job.
--
--  Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--  Safe to re-run. Nothing is dropped, nothing is backfilled, and the app works
--  exactly as it does today until this exists — the pull is best-effort and a
--  missing table simply leaves the phone on its own corpus.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table
--
-- NO FOREIGN KEY to dm_contractors, deliberately. That table belongs to CH
-- Tracker, and a cascade would erase everything the team has taught about a
-- supplier the day someone tidies that supplier's row up — the exact forgetting
-- this migration exists to end. The phone resolves the uuid when it reads, and
-- a uuid it cannot resolve is skipped. A tidy-up elsewhere costs a suggestion,
-- never the memory.
-- ----------------------------------------------------------------------------
create table if not exists public.dm_learn_contractor (
    token         text        not null,
    contractor_id uuid        not null,
    -- Role-weighted, same scale as dm_trade_learning.w: a manager's verdict
    -- counts for more than a first guess, and a correction decays what it
    -- replaced rather than leaving both equally true.
    w             numeric     not null default 0,
    -- How many separate observations, regardless of weight. This is what the
    -- review screen shows as "×N" — evidence COUNT is a different question
    -- from how much of it agreed.
    n             integer     not null default 0,
    -- Drives decay. The app halves the weight of evidence as it ages (a
    -- half-life, applied when READ), so a sub who left the panel fades while
    -- one who works every week stays sharp. Decay at read, not by a cron job:
    -- nothing is ever mutated, the half-life can be re-tuned in a deploy, and
    -- no scheduled job can silently eat the table.
    last_seen_at  timestamptz not null default now(),
    primary key (token, contractor_id)
);

comment on table public.dm_learn_contractor is
    'Shared phrase-token -> contractor memory for the Defect Manager''s "learned ×N" suggestions. Words and tallies only, never defect text. Written exclusively through dm_learn_contractor_bulk(); read by every authenticated user. See 2026-11-20_contractor_learning.sql.';

create index if not exists dm_learn_contractor_token_idx
    on public.dm_learn_contractor (token);

-- ----------------------------------------------------------------------------
-- 2. RLS — everyone reads, nobody writes directly
--
-- The whole point is a memory every supervisor shares, so SELECT is open to
-- authenticated. There is deliberately NO write policy: the only way in is the
-- security-definer function below, which bounds what a single call can do.
-- ----------------------------------------------------------------------------
alter table public.dm_learn_contractor enable row level security;

drop policy if exists dm_learn_contractor_read on public.dm_learn_contractor;
create policy dm_learn_contractor_read on public.dm_learn_contractor
    for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 3. One call per assignment
--
-- A defect's wording yields a handful of tokens, and writing them one RPC at a
-- time would put eight round trips behind every Save on a phone on site. This
-- takes the lot, and optionally the contractor the assignment was moved OFF —
-- a reassignment is a correction, and the trade side already treats it as one.
--
-- SECURITY DEFINER because authenticated has no write policy: this function is
-- the only door. search_path is pinned, as it must be for any definer function.
-- ----------------------------------------------------------------------------
create or replace function public.dm_learn_contractor_bulk(
    p_tokens     text[],
    p_contractor uuid,
    p_weight     numeric default 1,
    p_wrong      uuid    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tok  text;
    v_w    numeric := greatest(0.1, least(50, coalesce(p_weight, 1)));
    v_seen int := 0;
begin
    if auth.uid() is null or p_contractor is null or p_tokens is null then
        return;
    end if;

    foreach v_tok in array p_tokens loop
        -- Bounded on purpose: a pathological description must not be able to
        -- write hundreds of rows, and a token longer than this is not a word.
        v_seen := v_seen + 1;
        exit when v_seen > 12;
        continue when v_tok is null or length(v_tok) < 2 or length(v_tok) > 40;

        insert into public.dm_learn_contractor as t (token, contractor_id, w, n, last_seen_at)
        values (lower(v_tok), p_contractor, v_w, 1, now())
        on conflict (token, contractor_id) do update
            set w = t.w + v_w,
                n = t.n + 1,
                last_seen_at = now();

        -- The correction half: what it was moved off loses ground on the same
        -- words. Never below zero, and the row is kept so the history of the
        -- correction is not lost.
        if p_wrong is not null and p_wrong <> p_contractor then
            update public.dm_learn_contractor
               set w = greatest(0, w - v_w)
             where token = lower(v_tok) and contractor_id = p_wrong;
        end if;
    end loop;
end $$;

revoke all on function public.dm_learn_contractor_bulk(text[], uuid, numeric, uuid) from public;
grant execute on function public.dm_learn_contractor_bulk(text[], uuid, numeric, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verify (expect: five trues)
-- ----------------------------------------------------------------------------
select
    to_regclass('public.dm_learn_contractor')                      is not null as table_exists,
    (select relrowsecurity from pg_class
      where oid = 'public.dm_learn_contractor'::regclass)                      as rls_on,
    exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'dm_learn_contractor'
               and policyname = 'dm_learn_contractor_read')                    as read_policy,
    (select count(*) = 0 from pg_policies
      where schemaname = 'public' and tablename = 'dm_learn_contractor'
        and cmd <> 'SELECT')                                                   as no_direct_writes,
    to_regprocedure('public.dm_learn_contractor_bulk(text[], uuid, numeric, uuid)')
                                                                   is not null as rpc_exists;

-- ============================================================================
--  DONE. Nothing else to do — the phone picks the table up on its next sync
--  and starts both reading and writing it. Until then it is simply absent, and
--  the app behaves exactly as it does today.
--
--  To undo entirely:
--      drop function if exists public.dm_learn_contractor_bulk(text[], uuid, numeric, uuid);
--      drop table    if exists public.dm_learn_contractor;
-- ============================================================================
