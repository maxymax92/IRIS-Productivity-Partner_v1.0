-- =============================================================================
-- Migration: Semantic Memory Table and RPCs
-- Purpose: Add missing semantic_memory table, match_memories RPC, and align
--          search_embeddings with filter_project_id for memory edge function.
-- Reference: docs/architecture.md, supabase/functions/memory/index.ts
-- =============================================================================

-- =============================================================================
-- Step 1: memory_type enum (idempotent)
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_type') then
    create type public.memory_type as enum (
      'fact', 'conversation', 'task', 'project', 'preference'
    );
  end if;
end
$$;

-- =============================================================================
-- Step 2: semantic_memory table (episodic context)
-- =============================================================================
create table if not exists public.semantic_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  embedding extensions.vector(384) not null,
  memory_type public.memory_type not null,
  importance float default 0.5,
  source_type text,
  source_id uuid,
  metadata jsonb default '{}'::jsonb,
  project_id uuid references public.projects(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for semantic_memory
create index if not exists idx_semantic_memory_user_id
  on public.semantic_memory(user_id);

create index if not exists idx_semantic_memory_project_id
  on public.semantic_memory(project_id)
  where project_id is not null;

create index if not exists idx_semantic_memory_expires_at
  on public.semantic_memory(expires_at)
  where expires_at is not null;

create index if not exists idx_semantic_memory_vector
  on public.semantic_memory
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- RLS
alter table public.semantic_memory enable row level security;

drop policy if exists "Users can view own semantic memories" on public.semantic_memory;
create policy "Users can view own semantic memories"
  on public.semantic_memory for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users can insert own semantic memories" on public.semantic_memory;
create policy "Users can insert own semantic memories"
  on public.semantic_memory for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users can update own semantic memories" on public.semantic_memory;
create policy "Users can update own semantic memories"
  on public.semantic_memory for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can delete own semantic memories" on public.semantic_memory;
create policy "Users can delete own semantic memories"
  on public.semantic_memory for delete to authenticated using (user_id = auth.uid());

-- =============================================================================
-- Step 3: match_memories RPC (semantic search over episodic memory)
-- =============================================================================
-- Drop old 4-param version if it exists (no p_project_id)
drop function if exists public.match_memories(
  extensions.vector(384),
  float,
  int,
  uuid
);

create or replace function public.match_memories(
  query_embedding extensions.vector(384),
  match_threshold float default 0.5,
  match_count int default 10,
  p_user_id uuid default null,
  p_project_id uuid default null
)
returns table (
  id uuid,
  content text,
  memory_type public.memory_type,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    sm.id,
    sm.content,
    sm.memory_type,
    sm.metadata,
    1 - (sm.embedding <=> query_embedding) as similarity,
    sm.created_at
  from public.semantic_memory sm
  where
    sm.user_id = coalesce(p_user_id, auth.uid())
    and (p_project_id is null or sm.project_id = p_project_id)
    and (sm.expires_at is null or sm.expires_at > now())
    and 1 - (sm.embedding <=> query_embedding) > match_threshold
  order by sm.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function public.match_memories to authenticated;

-- =============================================================================
-- Step 4: Add project_id to knowledge_embeddings if missing
-- =============================================================================
alter table public.knowledge_embeddings
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_knowledge_embeddings_project_id
  on public.knowledge_embeddings(project_id)
  where project_id is not null;

-- =============================================================================
-- Step 5: search_embeddings with filter_project_id (align with memory edge fn)
-- =============================================================================
-- Drop old 5-param version to avoid ambiguity with new 6-param version
drop function if exists public.search_embeddings(
  extensions.vector(384),
  float,
  int,
  text,
  uuid
);

create or replace function public.search_embeddings(
  query_embedding extensions.vector(384),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_content_type text default null,
  filter_user_id uuid default null,
  filter_project_id uuid default null
)
returns table (
  id uuid,
  content text,
  content_type text,
  source_id uuid,
  source_table text,
  meta jsonb,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    ke.id,
    ke.content,
    ke.content_type,
    ke.source_id,
    ke.source_table,
    ke.meta,
    1 - (ke.embedding <=> query_embedding) as similarity
  from public.knowledge_embeddings ke
  where
    ke.user_id = coalesce(filter_user_id, auth.uid())
    and (filter_content_type is null or ke.content_type = filter_content_type)
    and (filter_project_id is null or ke.project_id = filter_project_id)
    and 1 - (ke.embedding <=> query_embedding) > match_threshold
  order by ke.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function public.search_embeddings to authenticated;
