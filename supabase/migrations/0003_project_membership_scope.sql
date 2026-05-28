alter table public.profiles
add column membership_scope text not null default 'workspace'
check (membership_scope in ('workspace', 'project'));

update public.profiles
set membership_scope = 'workspace'
where membership_scope is null;

insert into public.project_members (project_id, profile_id)
select projects.id, profiles.id
from public.projects
cross join public.profiles
where profiles.membership_scope = 'workspace'
on conflict do nothing;

create index profiles_membership_scope_idx on public.profiles(membership_scope);

create or replace function public.validate_profile_membership_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'manager' and new.membership_scope <> 'workspace' then
    raise exception 'Managers must be workspace members';
  end if;

  if new.membership_scope = 'project' and exists (
    select 1
    from public.project_members
    where profile_id = new.id
    offset 1
  ) then
    raise exception 'Project members can only belong to one project';
  end if;

  return new;
end;
$$;

create trigger profiles_membership_scope_check
before insert or update of role, membership_scope on public.profiles
for each row execute function public.validate_profile_membership_scope();

create or replace function public.validate_project_member_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  member_profile public.profiles%rowtype;
begin
  select * into member_profile
  from public.profiles
  where id = new.profile_id;

  if member_profile.id is null then
    raise exception 'Profile % does not exist', new.profile_id;
  end if;

  if member_profile.membership_scope = 'project' and exists (
    select 1
    from public.project_members
    where profile_id = new.profile_id
      and project_id <> new.project_id
  ) then
    raise exception 'Project members can only belong to one project';
  end if;

  return new;
end;
$$;

create trigger project_members_scope_check
before insert or update on public.project_members
for each row execute function public.validate_project_member_scope();

create or replace function public.sync_workspace_profile_to_projects()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.membership_scope = 'workspace' then
    insert into public.project_members (project_id, profile_id)
    select id, new.id
    from public.projects
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger profiles_sync_workspace_projects
after insert or update of membership_scope on public.profiles
for each row execute function public.sync_workspace_profile_to_projects();

create or replace function public.sync_project_workspace_members()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.project_members (project_id, profile_id)
  select new.id, id
  from public.profiles
  where membership_scope = 'workspace'
  on conflict do nothing;

  return new;
end;
$$;

create trigger projects_sync_workspace_members
after insert on public.projects
for each row execute function public.sync_project_workspace_members();

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

create or replace function public.reconcile_profile_identity(
  p_auth0_sub text,
  p_email text,
  p_display_name text,
  p_avatar_url text,
  p_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_auth0_sub text;
  normalized_email citext;
  requested_role text;
  requested_scope text;
  sub_profile public.profiles%rowtype;
  email_profile public.profiles%rowtype;
  resolved_profile public.profiles%rowtype;
begin
  normalized_auth0_sub := nullif(trim(p_auth0_sub), '');
  normalized_email := lower(trim(p_email))::citext;
  requested_role := case when p_role = 'manager' then 'manager' else 'member' end;
  requested_scope := case when requested_role = 'manager' then 'workspace' else 'project' end;

  if normalized_auth0_sub is null or normalized_email::text = '' then
    raise exception 'Auth0 subject and email are required';
  end if;

  lock table public.profiles in share row exclusive mode;

  select * into sub_profile
  from public.profiles
  where auth0_sub = normalized_auth0_sub
  limit 1
  for update;

  select * into email_profile
  from public.profiles
  where email = normalized_email
  limit 1
  for update;

  if sub_profile.id is not null and email_profile.id is not null and sub_profile.id <> email_profile.id then
    perform public.merge_profiles(email_profile.id, sub_profile.id);

    select * into email_profile
    from public.profiles
    where id = email_profile.id
    for update;
  end if;

  if email_profile.id is not null then
    update public.profiles
    set
      auth0_sub = normalized_auth0_sub,
      email = normalized_email,
      display_name = coalesce(nullif(display_name, ''), nullif(trim(p_display_name), ''), normalized_email::text),
      avatar_url = coalesce(p_avatar_url, avatar_url)
    where id = email_profile.id
    returning * into resolved_profile;

    return resolved_profile;
  end if;

  if sub_profile.id is not null then
    update public.profiles
    set
      email = normalized_email,
      display_name = coalesce(nullif(display_name, ''), nullif(trim(p_display_name), ''), normalized_email::text),
      avatar_url = coalesce(p_avatar_url, avatar_url)
    where id = sub_profile.id
    returning * into resolved_profile;

    return resolved_profile;
  end if;

  insert into public.profiles (auth0_sub, email, display_name, avatar_url, role, membership_scope)
  values (
    normalized_auth0_sub,
    normalized_email,
    coalesce(nullif(trim(p_display_name), ''), normalized_email::text),
    p_avatar_url,
    requested_role,
    requested_scope
  )
  returning * into resolved_profile;

  return resolved_profile;
end;
$$;

create or replace function public.upsert_invited_profile(
  p_email text,
  p_display_name text,
  p_role text,
  p_membership_scope text default 'workspace'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email citext;
  requested_role text;
  requested_scope text;
  existing_profile public.profiles%rowtype;
  resolved_profile public.profiles%rowtype;
begin
  normalized_email := lower(trim(p_email))::citext;
  requested_role := case when p_role = 'manager' then 'manager' else 'member' end;
  requested_scope := case
    when requested_role = 'manager' then 'workspace'
    when p_membership_scope = 'project' then 'project'
    else 'workspace'
  end;

  if normalized_email::text = '' then
    raise exception 'Email is required';
  end if;

  lock table public.profiles in share row exclusive mode;

  select * into existing_profile
  from public.profiles
  where email = normalized_email
  limit 1
  for update;

  if existing_profile.id is not null then
    update public.profiles
    set
      email = normalized_email,
      display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
      role = requested_role,
      membership_scope = requested_scope
    where id = existing_profile.id
    returning * into resolved_profile;

    return resolved_profile;
  end if;

  insert into public.profiles (auth0_sub, email, display_name, role, membership_scope)
  values (
    'pending|' || normalized_email::text,
    normalized_email,
    coalesce(nullif(trim(p_display_name), ''), normalized_email::text),
    requested_role,
    requested_scope
  )
  returning * into resolved_profile;

  return resolved_profile;
end;
$$;

create or replace function public.upsert_invited_profile(
  p_email text,
  p_display_name text,
  p_role text
)
returns public.profiles
language sql
security definer
set search_path = public
as $$
  select public.upsert_invited_profile(p_email, p_display_name, p_role, 'workspace');
$$;

revoke execute on function public.upsert_invited_profile(text, text, text, text) from public;
grant execute on function public.upsert_invited_profile(text, text, text, text) to service_role;
