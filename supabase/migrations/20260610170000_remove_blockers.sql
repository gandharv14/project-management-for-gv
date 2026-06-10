-- Remove the dedicated blockers feature. Blocking is now tracked solely via
-- the "blocked" task status (kanban queue).

-- Drop blocker-linked notifications and their column/constraint references.
delete from public.notifications where type = 'blocker_status_changed';

alter table public.notifications drop constraint if exists notifications_type_check;

alter table public.notifications
add constraint notifications_type_check check (
  type in (
    'assignment_created',
    'recurring_task_created',
    'recurring_task_missed',
    'suggestion_traction',
    'suggestion_promoted',
    'flag_removal_requested'
  )
);

drop index if exists public.notifications_blocker_idx;

alter table public.notifications drop column if exists blocker_id;

-- Drop the blockers table (also removes its indexes, triggers, and realtime
-- publication membership).
drop table if exists public.blockers;

-- Recreate merge_profiles without blocker reassignment.
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
