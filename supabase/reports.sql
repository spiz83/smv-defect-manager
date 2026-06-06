-- Imported inspection reports (history for View Recent / Delete Report).
create table if not exists public.dm_reports (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces (id) on delete cascade,
    name          text,
    address_id    uuid references public.dm_addresses (id) on delete set null,
    defect_count  integer not null default 0,
    created_at    timestamptz not null default now()
);

create index if not exists dm_reports_ws_idx on public.dm_reports (workspace_id);

alter table public.dm_reports enable row level security;

drop policy if exists dm_reports_member on public.dm_reports;
create policy dm_reports_member on public.dm_reports
    for all
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
