alter table public.project_user_flags
alter column email drop not null;

alter table public.project_user_flags
add constraint project_user_flags_email_or_alias_check
check (email is not null or alias_email is not null);
