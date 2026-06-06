create or replace function public.project_user_flag_identifier(p_identifier text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(p_identifier)), '')
$$;

create or replace function public.project_user_flag_stage_rank(p_stage text)
returns integer
language sql
immutable
as $$
  select case coalesce(p_stage, 'flagged')
    when 'flagged' then 1
    when 'warned' then 2
    when 'remove_requested' then 3
    when 'removed' then 4
    else 0
  end
$$;

update public.project_user_flags
set
  email = public.project_user_flag_identifier(email),
  alias_email = public.project_user_flag_identifier(alias_email)
where
  email is distinct from public.project_user_flag_identifier(email)
  or alias_email is distinct from public.project_user_flag_identifier(alias_email);

do $$
declare
  duplicate record;
begin
  for duplicate in
    with ranked as (
      select
        id,
        project_id,
        email,
        alias_email,
        created_at,
        ((email is not null)::integer + (alias_email is not null)::integer) as identifier_count,
        public.project_user_flag_stage_rank(stage) as stage_rank
      from public.project_user_flags
    )
    select distinct on (drop_flag.id)
      keep_flag.id as keep_id,
      drop_flag.id as drop_id
    from ranked as drop_flag
    join lateral (
      select candidate.id
      from ranked as candidate
      where candidate.project_id = drop_flag.project_id
        and candidate.id <> drop_flag.id
        and (
          (drop_flag.email is not null and drop_flag.email in (candidate.email, candidate.alias_email))
          or (drop_flag.alias_email is not null and drop_flag.alias_email in (candidate.email, candidate.alias_email))
        )
        and (
          candidate.identifier_count > drop_flag.identifier_count
          or (
            candidate.identifier_count = drop_flag.identifier_count
            and candidate.stage_rank > drop_flag.stage_rank
          )
          or (
            candidate.identifier_count = drop_flag.identifier_count
            and candidate.stage_rank = drop_flag.stage_rank
            and candidate.created_at < drop_flag.created_at
          )
          or (
            candidate.identifier_count = drop_flag.identifier_count
            and candidate.stage_rank = drop_flag.stage_rank
            and candidate.created_at = drop_flag.created_at
            and candidate.id < drop_flag.id
          )
        )
      order by
        candidate.identifier_count desc,
        candidate.stage_rank desc,
        candidate.created_at asc,
        candidate.id asc
      limit 1
    ) as keep_flag on true
    order by drop_flag.id, keep_flag.id
  loop
    update public.project_user_flag_events
    set flag_id = duplicate.keep_id
    where flag_id = duplicate.drop_id;

    update public.project_user_flags as keep_flag
    set
      email = coalesce(keep_flag.email, drop_flag.email),
      alias_email = case
        when keep_flag.alias_email is not null then keep_flag.alias_email
        when drop_flag.alias_email is not null and drop_flag.alias_email is distinct from keep_flag.email then drop_flag.alias_email
        when drop_flag.email is not null and drop_flag.email is distinct from keep_flag.email then drop_flag.email
        else keep_flag.alias_email
      end,
      discord_id = coalesce(keep_flag.discord_id, drop_flag.discord_id),
      task_link = coalesce(keep_flag.task_link, drop_flag.task_link),
      screenshot_urls = (
        select coalesce(array_agg(distinct url), '{}'::text[])
        from unnest(keep_flag.screenshot_urls || drop_flag.screenshot_urls) as merged(url)
      ),
      reason = case
        when keep_flag.reason = drop_flag.reason then keep_flag.reason
        when position(drop_flag.reason in keep_flag.reason) > 0 then keep_flag.reason
        else concat_ws(E'\n\n', keep_flag.reason, 'Merged duplicate report:', drop_flag.reason)
      end,
      stage = case
        when public.project_user_flag_stage_rank(drop_flag.stage) > public.project_user_flag_stage_rank(keep_flag.stage)
          then drop_flag.stage
        else keep_flag.stage
      end,
      stage_updated_at = case
        when public.project_user_flag_stage_rank(drop_flag.stage) > public.project_user_flag_stage_rank(keep_flag.stage)
          then drop_flag.stage_updated_at
        else keep_flag.stage_updated_at
      end,
      stage_updated_by = case
        when public.project_user_flag_stage_rank(drop_flag.stage) > public.project_user_flag_stage_rank(keep_flag.stage)
          then drop_flag.stage_updated_by
        else keep_flag.stage_updated_by
      end
    from public.project_user_flags as drop_flag
    where keep_flag.id = duplicate.keep_id
      and drop_flag.id = duplicate.drop_id;

    delete from public.project_user_flags
    where id = duplicate.drop_id;
  end loop;
end;
$$;

create index if not exists project_user_flags_project_email_identifier_idx
on public.project_user_flags (project_id, public.project_user_flag_identifier(email))
where email is not null;

create index if not exists project_user_flags_project_alias_identifier_idx
on public.project_user_flags (project_id, public.project_user_flag_identifier(alias_email))
where alias_email is not null;

create or replace function public.prevent_duplicate_project_user_flag_identifier()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  identifiers text[];
  existing_identifier text;
begin
  new.email := public.project_user_flag_identifier(new.email);
  new.alias_email := public.project_user_flag_identifier(new.alias_email);
  identifiers := array(
    select distinct identifier
    from unnest(array[new.email, new.alias_email]) as submitted(identifier)
    where identifier is not null
  );

  if coalesce(array_length(identifiers, 1), 0) = 0 then
    raise exception 'A flagged user must have an email or alias email.';
  end if;

  select coalesce(existing.email, existing.alias_email)
  into existing_identifier
  from public.project_user_flags as existing
  where existing.project_id = new.project_id
    and existing.id <> new.id
    and (
      public.project_user_flag_identifier(existing.email) = any(identifiers)
      or public.project_user_flag_identifier(existing.alias_email) = any(identifiers)
    )
  order by existing.created_at asc
  limit 1;

  if existing_identifier is not null then
    raise exception 'This email address already exists in the flagged users list.'
      using errcode = '23505', constraint = 'project_user_flags_unique_identifier';
  end if;

  return new;
end;
$$;

drop trigger if exists project_user_flags_prevent_duplicate_identifier on public.project_user_flags;

create trigger project_user_flags_prevent_duplicate_identifier
before insert or update of project_id, email, alias_email on public.project_user_flags
for each row execute function public.prevent_duplicate_project_user_flag_identifier();
