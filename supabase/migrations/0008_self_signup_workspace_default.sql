-- Self-service SSO sign-ins were created with membership_scope = 'project' yet
-- never attached to any project, so they appeared in neither the Workspace
-- members list nor any project. Login self-signups should default to the
-- workspace scope (matching the single-team model where workspace members are
-- automatically part of every project). Project-only members continue to be
-- created exclusively through the invite flow (upsert_invited_profile).

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
  sub_profile public.profiles%rowtype;
  email_profile public.profiles%rowtype;
  resolved_profile public.profiles%rowtype;
begin
  normalized_auth0_sub := nullif(trim(p_auth0_sub), '');
  normalized_email := lower(trim(p_email))::citext;
  requested_role := case when p_role = 'manager' then 'manager' else 'member' end;

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

  -- New self-signup: default to workspace scope so they show up as workspace
  -- members and (via the sync trigger) get added to every project.
  insert into public.profiles (auth0_sub, email, display_name, avatar_url, role, membership_scope)
  values (
    normalized_auth0_sub,
    normalized_email,
    coalesce(nullif(trim(p_display_name), ''), normalized_email::text),
    p_avatar_url,
    requested_role,
    'workspace'
  )
  returning * into resolved_profile;

  return resolved_profile;
end;
$$;

-- Backfill the existing orphans: project-scoped profiles that were created by a
-- login self-signup and never attached to any project. Promoting them to the
-- workspace scope fires sync_workspace_profile_to_projects, which adds them to
-- all current projects.
update public.profiles p
set membership_scope = 'workspace'
where p.membership_scope = 'project'
  and not exists (
    select 1 from public.project_members pm where pm.profile_id = p.id
  );
