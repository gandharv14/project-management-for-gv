alter table public.notifications
add column if not exists task_id uuid references public.tasks(id) on delete cascade;

alter table public.notifications
add column if not exists blocker_id uuid references public.blockers(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;

alter table public.notifications
add constraint notifications_type_check check (
  type in (
    'assignment_created',
    'blocker_status_changed',
    'recurring_task_created',
    'recurring_task_missed',
    'suggestion_traction',
    'suggestion_promoted'
  )
);

create index if not exists notifications_task_idx on public.notifications(task_id);
create index if not exists notifications_blocker_idx on public.notifications(blocker_id);

alter table public.tasks
add column if not exists overdue_notified_at timestamptz;
