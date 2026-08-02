-- Shopping list: parts and materials the SUPERVISOR has to order before a
-- trade can finish an item. (Spiro 2026-08-02)
--
-- Additive and nullable, so it is safe to run against the live database while
-- both apps are in use — nothing reads it until a client sets it, and CH
-- Tracker is unaffected.
--
-- The phone app PROBES for this column before every defect write and simply
-- omits it when it isn't there (see ensureOrderColumn in cloud-sync.js), so the
-- app works either way. Until this runs, shopping-list flags stay on the phone
-- that set them and don't reach the supervisor's other devices.
--
-- Run in the Supabase SQL editor for project cubwwnvzmeydyixhetfb.

alter table public.dm_defects
    add column if not exists order_status text;

comment on column public.dm_defects.order_status is
    'Supervisor shopping list. NULL/'''' = not needed, ''needed'' = to order, ''ordered'' = ordered, ''done'' = in hand. The defect stays open until the trade fits the part.';

-- Only ever queried as "what is still to pick up", and only for defects that
-- are not completed, so the partial index is the whole working set.
create index if not exists dm_defects_order_status_idx
    on public.dm_defects (order_status)
    where order_status in ('needed', 'ordered');
