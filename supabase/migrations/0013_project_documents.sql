create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  url text not null check (url ~* '^https?://'),
  document_type text not null default 'doc' check (document_type in ('doc', 'sheet', 'slide', 'folder', 'other')),
  tags text[] not null default '{}',
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_position(tags, '') is null)
);

create index if not exists project_documents_project_type_updated_idx
on public.project_documents(project_id, document_type, updated_at desc);

create index if not exists project_documents_tags_idx
on public.project_documents using gin(tags);

create trigger project_documents_updated_at before update on public.project_documents
for each row execute function public.set_updated_at();

alter table public.project_documents enable row level security;

alter publication supabase_realtime add table public.project_documents;
