-- =============================================================================
-- Migration: Knowledge Embeddings Table
-- Purpose: Store vector embeddings for semantic search capabilities
-- Schema Design: Hybrid (structured columns + JSONB for flexibility)
-- =============================================================================

-- Enable the pgvector extension for vector operations
create extension if not exists vector with schema extensions;

-- =============================================================================
-- Table: knowledge_embeddings
-- =============================================================================
-- Stores embeddings for various content types (notes, tasks, conversations, etc.)
-- Uses 1536 dimensions to match OpenAI's text-embedding-3-small model
-- Hybrid schema: known fields as columns, variable fields in meta JSONB

create table if not exists public.knowledge_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Core content fields (structured)
  content text not null,                          -- The text content that was embedded
  content_type text not null,                     -- Type: 'note', 'task', 'conversation', 'file', etc.
  source_id uuid,                                 -- Reference to source record (note_id, task_id, etc.)
  source_table text,                              -- Source table name for polymorphic reference

  -- Vector embedding (1536 dimensions for OpenAI text-embedding-3-small)
  embedding extensions.vector(1536),

  -- Flexible metadata (unstructured)
  meta jsonb default '{}'::jsonb,                 -- Variable fields: tags, context, timestamps, etc.

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Primary lookup: user's embeddings by type
create index idx_knowledge_embeddings_user_type
  on public.knowledge_embeddings(user_id, content_type);

-- Source reference lookup
create index idx_knowledge_embeddings_source
  on public.knowledge_embeddings(source_table, source_id)
  where source_id is not null;

-- JSONB index for meta field queries
create index idx_knowledge_embeddings_meta
  on public.knowledge_embeddings using gin(meta jsonb_path_ops);

-- Vector index using HNSW with cosine distance (recommended by Supabase)
-- HNSW is preferred over IVFFlat for:
-- 1. Better performance with changing data (no need to rebuild)
-- 2. Can be created on empty tables
-- 3. Better query performance at scale
-- m=16 (default): bi-directional links per element
-- ef_construction=64 (default): nearest neighbors during construction
create index idx_knowledge_embeddings_vector
  on public.knowledge_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.knowledge_embeddings enable row level security;

-- Policy: Users can only access their own embeddings
create policy "Users can view own embeddings"
  on public.knowledge_embeddings
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own embeddings"
  on public.knowledge_embeddings
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own embeddings"
  on public.knowledge_embeddings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own embeddings"
  on public.knowledge_embeddings
  for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- Functions
-- =============================================================================

-- Similarity search function with cosine distance
-- Returns embeddings ordered by similarity to the query vector
create or replace function public.search_embeddings(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_content_type text default null,
  filter_user_id uuid default null
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
set search_path = public
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
    -- User filter (required for RLS bypass in security definer)
    ke.user_id = coalesce(filter_user_id, auth.uid())
    -- Optional content type filter
    and (filter_content_type is null or ke.content_type = filter_content_type)
    -- Similarity threshold
    and 1 - (ke.embedding <=> query_embedding) > match_threshold
  order by ke.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Grant execute permission to authenticated users
grant execute on function public.search_embeddings to authenticated;

-- =============================================================================
-- Triggers
-- =============================================================================

-- Auto-update updated_at timestamp
create or replace function public.update_embedding_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_knowledge_embeddings_updated
  before update on public.knowledge_embeddings
  for each row
  execute function public.update_embedding_timestamp();

-- =============================================================================
-- Comments
-- =============================================================================

comment on table public.knowledge_embeddings is
  'Stores vector embeddings for semantic search across user content';

comment on column public.knowledge_embeddings.embedding is
  '1536-dimensional vector for OpenAI text-embedding-3-small compatibility';

comment on column public.knowledge_embeddings.meta is
  'Flexible JSONB field for variable metadata like tags, context, etc.';

comment on function public.search_embeddings is
  'Performs semantic similarity search using cosine distance with optional filters';
