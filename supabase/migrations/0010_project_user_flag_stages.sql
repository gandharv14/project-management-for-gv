alter table public.project_user_flags
add column if not exists stage text not null default 'flagged';

alter table public.project_user_flags drop constraint if exists project_user_flags_stage_check;

alter table public.project_user_flags
add constraint project_user_flags_stage_check check (
  stage in ('flagged', 'warned', 'remove_requested', 'removed')
);

alter table public.project_user_flags
add column if not exists stage_updated_at timestamptz;

alter table public.project_user_flags
add column if not exists stage_updated_by uuid references public.profiles(id) on delete set null;

create table if not exists public.project_user_flag_events (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null references public.project_user_flags(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null check (
    stage in ('flagged', 'warned', 'remove_requested', 'removed')
  ),
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_user_flag_events_flag_created_idx
on public.project_user_flag_events(flag_id, created_at desc);

alter table public.project_user_flag_events enable row level security;

alter publication supabase_realtime add table public.project_user_flag_events;

alter table public.notifications drop constraint if exists notifications_type_check;

alter table public.notifications
add constraint notifications_type_check check (
  type in (
    'assignment_created',
    'blocker_status_changed',
    'recurring_task_created',
    'recurring_task_missed',
    'suggestion_traction',
    'suggestion_promoted',
    'flag_removal_requested'
  )
);
