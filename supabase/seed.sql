-- Optional local seed. Replace the Auth0 subject and email before running.
insert into public.profiles (auth0_sub, email, display_name, role)
values ('auth0|replace-me', 'you@labelbox.com', 'Team Manager', 'manager')
on conflict (email) do update
set display_name = excluded.display_name,
    role = excluded.role;

insert into public.projects (name, description)
values ('General', 'Default project for team tasks, blockers, and suggestions.')
on conflict do nothing;

insert into public.project_members (project_id, profile_id)
select p.id, pr.id
from public.projects p
cross join public.profiles pr
where p.name = 'General'
  and pr.email = 'you@labelbox.com'
on conflict do nothing;
