-- =============================================================================
-- Migration: File Version History (Server-Side Git)
-- Purpose: Git-like commit history for user files stored in Supabase Storage
-- Architecture: Linked-list commits + file change records + branch head pointers
-- =============================================================================

-- =============================================================================
-- Table: file_commits — one row per commit (linked list via parent_id)
-- =============================================================================

create table if not exists public.file_commits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  parent_id uuid references public.file_commits(id),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Table: file_commit_files — which files changed in each commit
-- =============================================================================

create table if not exists public.file_commit_files (
  id uuid primary key default gen_random_uuid(),
  commit_id uuid not null references public.file_commits(id) on delete cascade,
  path text not null,
  action text not null check (action in ('add', 'modify', 'delete')),
  size bigint,
  content_type text
);

-- =============================================================================
-- Table: file_refs — branch head pointers
-- =============================================================================

create table if not exists public.file_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'main',
  head_commit_id uuid references public.file_commits(id),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

-- =============================================================================
-- Indexes
-- =============================================================================

create index idx_file_commits_user_created
  on public.file_commits(user_id, created_at desc);

create index idx_file_commits_parent
  on public.file_commits(parent_id)
  where parent_id is not null;

create index idx_file_commit_files_commit
  on public.file_commit_files(commit_id);

-- file_refs(user_id, name) is already covered by the unique constraint

-- =============================================================================
-- Row Level Security: file_commits
-- =============================================================================

alter table public.file_commits enable row level security;

create policy "Users can view own file commits"
  on public.file_commits
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own file commits"
  on public.file_commits
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own file commits"
  on public.file_commits
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own file commits"
  on public.file_commits
  for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- Row Level Security: file_commit_files (scoped via join to file_commits)
-- =============================================================================

alter table public.file_commit_files enable row level security;

create policy "Users can view own commit files"
  on public.file_commit_files
  for select
  to authenticated
  using (
    exists (
      select 1 from public.file_commits
      where file_commits.id = file_commit_files.commit_id
        and file_commits.user_id = auth.uid()
    )
  );

create policy "Users can insert own commit files"
  on public.file_commit_files
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.file_commits
      where file_commits.id = file_commit_files.commit_id
        and file_commits.user_id = auth.uid()
    )
  );

create policy "Users can delete own commit files"
  on public.file_commit_files
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.file_commits
      where file_commits.id = file_commit_files.commit_id
        and file_commits.user_id = auth.uid()
    )
  );

-- =============================================================================
-- Row Level Security: file_refs
-- =============================================================================

alter table public.file_refs enable row level security;

create policy "Users can view own file refs"
  on public.file_refs
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own file refs"
  on public.file_refs
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own file refs"
  on public.file_refs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own file refs"
  on public.file_refs
  for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- Comments
-- =============================================================================

comment on table public.file_commits is
  'Git-like commit history for user files. Each row is one commit in a linked list (parent_id).';

comment on table public.file_commit_files is
  'Files changed in each commit. Inherits user scoping through FK to file_commits.';

comment on table public.file_refs is
  'Branch head pointers. Each user has a default "main" ref created on first commit.';
