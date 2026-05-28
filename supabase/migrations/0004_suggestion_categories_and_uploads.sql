alter table public.suggestions
add column category text not null default 'project'
check (category in ('proposal', 'project', 'management', 'process', 'tooling', 'other'));

create index suggestions_project_category_status_idx
on public.suggestions(project_id, category, status, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'suggestion-screenshots',
  'suggestion-screenshots',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
