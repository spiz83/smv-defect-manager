-- ============================================================================
--  AI call quota  —  2026-09-19
-- ----------------------------------------------------------------------------
--  WHY: supabase/functions/extract-defects called claude-opus-5 with no auth
--  check and no rate limit. The function never read the Authorization header,
--  so it had no notion of WHO was calling — which meant the 50 calls/user/day
--  figure in the tracker's 05_AI_PROMPTS.md could not be enforced even in
--  principle. The public anon key ships in index.html (correctly — it is the
--  key the browser signs in with), so anyone who opened the site could POST to
--  that function as often as they liked. Only per-CALL size caps existed.
--
--  This adds the counter the cap needs. The auth check itself lives in the
--  function and needs nothing from the database.
--
--  SHARED BY DESIGN, and deliberately NOT dm_-prefixed. The same spec covers
--  four LLM functions across both apps on this one database; an `fn` column
--  means CH Tracker's three can adopt this table as-is, without a second
--  migration or a second convention. Nothing here is Defect-Manager specific.
--  (Flagged for the tracker side rather than assumed — this creates a new
--  table and changes nothing existing, so adopting it is their call, and
--  ignoring it costs them nothing.)
--
--  SAFE TO RUN ANY TIME. It only CREATEs. It alters no existing table, drops
--  no policy, and touches nothing CH Tracker reads today.
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
--              (Or: SUPA_PAT=.. SUPA_REF=.. node scripts/run-sql.mjs \
--                   supabase/migrations/2026-09-19_ai_call_quota.sql)
--  Idempotent — re-running is a no-op.
-- ============================================================================

-- One row per user, per UTC day, per function.
--
-- UTC, not local: the edge function runs in UTC and a day boundary that moves
-- with the caller's timezone is a day boundary you cannot reason about. The
-- practical effect for Melbourne is that the quota resets at 10 or 11am local
-- rather than midnight. That is fine for an abuse ceiling — it is not a
-- per-shift budget anyone is meant to feel.
create table if not exists public.ai_call_quota (
    user_id  uuid    not null references auth.users (id) on delete cascade,
    day      date    not null,
    fn       text    not null,
    calls    integer not null default 0,
    primary key (user_id, day, fn)
);

-- The sweep below is the only reason this index exists; the primary key serves
-- every read path.
create index if not exists ai_call_quota_day_idx on public.ai_call_quota (day);

alter table public.ai_call_quota enable row level security;

-- A user may read THEIR OWN usage and nothing else — enough for a client to
-- show "12 of 50 used today" without exposing anyone else's activity.
-- There is deliberately NO insert/update/delete policy: the only writer is the
-- edge function, through the SECURITY DEFINER function below, under the
-- service role (which bypasses RLS). A user must never be able to edit their
-- own counter — that would make the cap advisory.
drop policy if exists ai_call_quota_own_read on public.ai_call_quota;
create policy ai_call_quota_own_read on public.ai_call_quota
    for select using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
--  Atomic "count this call and tell me where it lands"
-- ----------------------------------------------------------------------------
--  One statement, so two calls racing cannot both read 49 and both proceed.
--  Returns the count AFTER incrementing, so the Nth call sees `used = N`.
--
--  p_user is passed in rather than read from auth.uid() because the caller is
--  the edge function running as the service role, where auth.uid() is null.
--  That makes this function dangerous in the wrong hands — anyone able to call
--  it could burn another user's quota — so EXECUTE is revoked from everyone
--  except service_role below. Do not widen that grant.
create or replace function public.ai_quota_bump(p_user uuid, p_fn text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_used integer;
begin
    insert into public.ai_call_quota (user_id, day, fn, calls)
    values (p_user, (now() at time zone 'utc')::date, p_fn, 1)
    -- Unqualified table name on purpose: inside ON CONFLICT DO UPDATE, Postgres
    -- resolves the existing row as `ai_call_quota.calls`. Schema-qualifying it
    -- (`public.ai_call_quota.calls`) is a three-part name it will not resolve
    -- there, and the function only fails when someone finally runs it.
    -- `search_path = public` above is what makes the bare name safe.
    on conflict (user_id, day, fn) do update
        set calls = ai_call_quota.calls + 1
    returning calls into v_used;
    return v_used;
end $$;

revoke all on function public.ai_quota_bump(uuid, text) from public;
revoke all on function public.ai_quota_bump(uuid, text) from anon;
revoke all on function public.ai_quota_bump(uuid, text) from authenticated;
grant execute on function public.ai_quota_bump(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
--  Housekeeping
-- ----------------------------------------------------------------------------
--  Counters are worthless the day after. Nothing sweeps them automatically —
--  pg_cron may or may not be enabled on this project (DECISIONS.md's Backups
--  note is unsure), so this is left as a one-liner to schedule or run by hand
--  rather than a job that silently was never installed:
--
--      delete from public.ai_call_quota where day < current_date - 30;
--
--  At ~1 row per user per day per function this table stays small for years
--  even if nobody ever runs it.

-- ----------------------------------------------------------------------------
--  Verify (expect: the table, one select-only policy, and one function whose
--  EXECUTE is granted to service_role alone).
-- ----------------------------------------------------------------------------
-- select policyname, cmd, qual from pg_policies
--  where schemaname = 'public' and tablename = 'ai_call_quota';
-- select proname, proacl from pg_proc where proname = 'ai_quota_bump';
