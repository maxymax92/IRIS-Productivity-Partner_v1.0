-- =============================================================================
-- Migration: Update Vector Dimension from 1536 to 384
-- Purpose: Switch from OpenAI embeddings (1536) to Supabase gte-small (384)
-- Note: This is a breaking change - existing embeddings must be regenerated
-- =============================================================================

-- =============================================================================
-- Step 1: Drop dependent objects (in order of dependency)
-- =============================================================================

-- Drop the search function that depends on the vector type
drop function if exists public.search_embeddings(
  extensions.vector(1536),
  float,
  int,
  text,
  uuid
);

-- Drop the vector index
drop index if exists idx_knowledge_embeddings_vector;

-- =============================================================================
-- Step 2: Alter the column type
-- =============================================================================

-- Change embedding dimension from 1536 (OpenAI) to 384 (gte-small)
-- Note: This will clear existing embeddings - they need to be regenerated
alter table public.knowledge_embeddings
  alter column embedding type extensions.vector(384)
  using null; -- Clear existing embeddings since dimensions don't match

-- =============================================================================
-- Step 3: Recreate the vector index with new dimension
-- =============================================================================

-- HNSW index for 384-dimension vectors using cosine distance
-- m=16: bi-directional links per element
-- ef_construction=64: nearest neighbors during construction
create index idx_knowledge_embeddings_vector
  on public.knowledge_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- =============================================================================
-- Step 4: Recreate the search function with new dimension
-- =============================================================================

create or replace function public.search_embeddings(
  query_embedding extensions.vector(384),  -- Changed from 1536 to 384
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
-- Step 5: Update comments
-- =============================================================================

comment on column public.knowledge_embeddings.embedding is
  '384-dimensional vector for Supabase gte-small model compatibility';

comment on function public.search_embeddings is
  'Performs semantic similarity search using cosine distance with 384-dim gte-small embeddings';
