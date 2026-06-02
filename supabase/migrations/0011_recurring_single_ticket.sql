-- Recurring duties: move from one task row per occurrence to a single live
-- ticket per rule that moves between board columns. Per-occurrence completion
-- history is preserved in a dedicated log table so the history dots and manager
-- completion stats keep working.

create table if not exists public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_rules(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurrence_date date not null,
  status text not null default 'pending' check (status in ('done', 'missed', 'pending')),
  assignee_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  notified_missed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, occurrence_date)
);

create index if not exists recurring_occurrences_rule_date_idx
on public.recurring_occurrences(rule_id, occurrence_date desc);

create trigger recurring_occurrences_updated_at before update on public.recurring_occurrences
for each row execute function public.set_updated_at();

alter table public.recurring_occurrences enable row level security;

alter publication supabase_realtime add table public.recurring_occurrences;

-- Backfill the history log from every existing recurring task instance. One row
-- per (rule, generated_for_date); completed tasks become done occurrences.
insert into public.recurring_occurrences (rule_id, project_id, occurrence_date, status, assignee_id, completed_at)
select
  t.recurring_rule_id,
  t.project_id,
  t.generated_for_date,
  case when t.status = 'done' then 'done' else 'pending' end,
  t.assignee_id,
  t.completed_at
from public.tasks t
where t.recurring_rule_id is not null
  and t.generated_for_date is not null
on conflict (rule_id, occurrence_date) do nothing;

-- Collapse existing duplicate instances down to a single live ticket per rule.
-- The survivor is the most recent occurrence (latest generated_for_date, then
-- latest created_at). Blockers and notifications that pointed at the duplicates
-- are re-pointed at the survivor so their history is not cascade-deleted.
with ranked as (
  select
    id,
    recurring_rule_id,
    row_number() over (
      partition by recurring_rule_id
      order by generated_for_date desc nulls last, created_at desc
    ) as rn
  from public.tasks
  where recurring_rule_id is not null
),
survivors as (
  select recurring_rule_id, id as survivor_id
  from ranked
  where rn = 1
),
duplicates as (
  select r.id as duplicate_id, s.survivor_id
  from ranked r
  join survivors s on s.recurring_rule_id = r.recurring_rule_id
  where r.rn > 1
)
update public.blockers b
set task_id = d.survivor_id
from duplicates d
where b.task_id = d.duplicate_id;

with ranked as (
  select
    id,
    recurring_rule_id,
    row_number() over (
      partition by recurring_rule_id
      order by generated_for_date desc nulls last, created_at desc
    ) as rn
  from public.tasks
  where recurring_rule_id is not null
),
survivors as (
  select recurring_rule_id, id as survivor_id
  from ranked
  where rn = 1
),
duplicates as (
  select r.id as duplicate_id, s.survivor_id
  from ranked r
  join survivors s on s.recurring_rule_id = r.recurring_rule_id
  where r.rn > 1
)
update public.notifications n
set task_id = d.survivor_id
from duplicates d
where n.task_id = d.duplicate_id;

with ranked as (
  select
    id,
    recurring_rule_id,
    row_number() over (
      partition by recurring_rule_id
      order by generated_for_date desc nulls last, created_at desc
    ) as rn
  from public.tasks
  where recurring_rule_id is not null
)
delete from public.tasks
where id in (select id from ranked where rn > 1);

-- Enforce a single live task per recurring rule going forward. The old
-- (recurring_rule_id, generated_for_date) uniqueness is replaced by uniqueness
-- on the rule alone.
alter table public.tasks drop constraint if exists tasks_recurring_rule_id_generated_for_date_key;

create unique index if not exists tasks_one_per_recurring_rule
on public.tasks(recurring_rule_id)
where recurring_rule_id is not null;
