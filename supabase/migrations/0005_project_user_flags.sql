create table public.project_user_flags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  flagged_by uuid references public.profiles(id) on delete set null,
  email text not null,
  discord_id text,
  alias_email text,
  reason text not null,
  task_link text,
  screenshot_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_user_flags_project_created_idx
on public.project_user_flags(project_id, created_at desc);

create index project_user_flags_flagged_by_idx
on public.project_user_flags(flagged_by);

create trigger project_user_flags_updated_at before update on public.project_user_flags
for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.project_user_flags;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flag-screenshots',
  'flag-screenshots',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.merge_profiles(p_target_id uuid, p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  source_profile public.profiles%rowtype;
  merged_auth0_sub text;
  merged_scope text;
  canonical_project_id uuid;
begin
  if p_target_id = p_source_id then
    return;
  end if;

  select * into target_profile from public.profiles where id = p_target_id for update;
  if not found then
    raise exception 'Target profile % does not exist', p_target_id;
  end if;

  select * into source_profile from public.profiles where id = p_source_id for update;
  if not found then
    return;
  end if;

  merged_scope := case
    when target_profile.membership_scope = 'workspace' or source_profile.membership_scope = 'workspace' then 'workspace'
    else 'project'
  end;

  if merged_scope = 'workspace' then
    insert into public.project_members (project_id, profile_id, created_at)
    select id, p_target_id, now()
    from public.projects
    on conflict do nothing;
  else
    select project_id into canonical_project_id
    from public.project_members
    where profile_id in (p_target_id, p_source_id)
    order by created_at asc
    limit 1;
  end if;

  if merged_scope = 'project' then
    delete from public.project_members where profile_id in (p_target_id, p_source_id);
    if canonical_project_id is not null then
      insert into public.project_members (project_id, profile_id)
      values (canonical_project_id, p_target_id);
    end if;
  end if;

  delete from public.project_members where profile_id = p_source_id;

  insert into public.suggestion_votes (suggestion_id, profile_id, created_at)
  select suggestion_id, p_target_id, min(created_at)
  from public.suggestion_votes
  where profile_id = p_source_id
  group by suggestion_id
  on conflict do nothing;
  delete from public.suggestion_votes where profile_id = p_source_id;

  update public.projects set created_by = p_target_id where created_by = p_source_id;
  update public.recurring_rules set assignee_id = p_target_id where assignee_id = p_source_id;
  update public.recurring_rules set created_by = p_target_id where created_by = p_source_id;
  update public.tasks set assignee_id = p_target_id where assignee_id = p_source_id;
  update public.tasks set created_by = p_target_id where created_by = p_source_id;
  update public.blockers set owner_id = p_target_id where owner_id = p_source_id;
  update public.blockers set raised_by = p_target_id where raised_by = p_source_id;
  update public.suggestions set author_id = p_target_id where author_id = p_source_id;
  update public.suggestion_comments set author_id = p_target_id where author_id = p_source_id;
  update public.project_user_flags set flagged_by = p_target_id where flagged_by = p_source_id;
  update public.notifications set profile_id = p_target_id where profile_id = p_source_id;
  update public.notifications set actor_id = p_target_id where actor_id = p_source_id;

  merged_auth0_sub := target_profile.auth0_sub;
  if target_profile.auth0_sub like 'pending|%' and source_profile.auth0_sub not like 'pending|%' then
    merged_auth0_sub := source_profile.auth0_sub;
  end if;

  delete from public.profiles where id = p_source_id;

  update public.profiles
  set
    auth0_sub = merged_auth0_sub,
    email = lower(trim(target_profile.email::text)),
    role = case
      when target_profile.role = 'manager' or source_profile.role = 'manager' then 'manager'
      else target_profile.role
    end,
    membership_scope = case
      when target_profile.role = 'manager' or source_profile.role = 'manager' then 'workspace'
      else merged_scope
    end,
    avatar_url = coalesce(target_profile.avatar_url, source_profile.avatar_url),
    updated_at = now()
  where id = p_target_id;
end;
$$;
