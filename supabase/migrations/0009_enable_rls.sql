-- Lock down direct REST/Realtime access via the public anon key.
--
-- Every application query runs through the Supabase service-role client
-- (see getSupabaseAdmin in src/lib/supabase.ts), which bypasses Row Level
-- Security. The anon and authenticated roles, however, were able to read and
-- write every table directly because RLS was never enabled. Enabling RLS with
-- no policies makes those roles default-deny while leaving the service role
-- (and the app) fully functional.

-- NOTE: only ENABLE (not FORCE) RLS. The app's SECURITY DEFINER functions and
-- triggers (reconcile_profile_identity, upsert_invited_profile, the membership
-- sync triggers) run as the table owner and must keep writing; FORCE would
-- subject the owner to RLS and break them. anon/authenticated are non-owner
-- roles, so plain ENABLE already denies them, and service_role bypasses RLS.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.blockers enable row level security;
alter table public.suggestions enable row level security;
alter table public.suggestion_votes enable row level security;
alter table public.suggestion_comments enable row level security;
alter table public.notifications enable row level security;
alter table public.project_user_flags enable row level security;

-- Explicitly strip the default Supabase grants from the public anon and
-- authenticated roles. The service_role keeps its grants and bypasses RLS.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- Prevent newly created objects from re-granting access to these roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
