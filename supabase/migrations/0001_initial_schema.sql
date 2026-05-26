create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null unique,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  role text not null default 'member' check (role in ('manager', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  frequency text not null check (frequency in ('daily', 'weekly', 'custom')),
  interval_days integer check (interval_days is null or interval_days > 0),
  weekdays integer[] not null default '{}',
  next_run_on date not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  recurring_rule_id uuid references public.recurring_rules(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'backlog' check (status in ('backlog', 'today', 'in_progress', 'blocked', 'done')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  generated_for_date date,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurring_rule_id, generated_for_date)
);

create table public.blockers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  owner_id uuid references public.profiles(id) on delete set null,
  raised_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task_id is null or project_id is not null)
);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'under_consideration', 'accepted', 'parked')),
  author_id uuid references public.profiles(id) on delete set null,
  promoted_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, profile_id)
);

create table public.suggestion_comments (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null check (
    type in (
      'assignment_created',
      'blocker_status_changed',
      'recurring_task_created',
      'suggestion_traction',
      'suggestion_promoted'
    )
  ),
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create index projects_archived_idx on public.projects(archived_at);
create index tasks_project_status_idx on public.tasks(project_id, status);
create index tasks_assignee_due_idx on public.tasks(assignee_id, due_date);
create index tasks_recurring_idx on public.tasks(recurring_rule_id, generated_for_date);
create index recurring_rules_next_run_idx on public.recurring_rules(next_run_on) where is_active;
create index blockers_project_status_idx on public.blockers(project_id, status, created_at);
create index blockers_task_idx on public.blockers(task_id);
create index suggestions_project_status_idx on public.suggestions(project_id, status, updated_at);
create index notifications_profile_read_idx on public.notifications(profile_id, read_at, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();

create trigger recurring_rules_updated_at before update on public.recurring_rules
for each row execute function public.set_updated_at();

create trigger tasks_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

create trigger blockers_updated_at before update on public.blockers
for each row execute function public.set_updated_at();

create trigger suggestions_updated_at before update on public.suggestions
for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.blockers;
alter publication supabase_realtime add table public.suggestions;
alter publication supabase_realtime add table public.suggestion_votes;
alter publication supabase_realtime add table public.suggestion_comments;
alter publication supabase_realtime add table public.notifications;
