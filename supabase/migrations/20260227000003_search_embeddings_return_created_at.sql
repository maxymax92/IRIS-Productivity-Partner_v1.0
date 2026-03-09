-- =============================================================================
-- Migration: Add created_at to search_embeddings return type
-- Purpose: Allow the agent to see when a memory was stored, so it can assess
--          freshness and flag stale results.
-- =============================================================================

-- Drop existing function to recreate with updated return type
drop function if exists public.search_embeddings(
  extensions.vector(384),
  float,
  int,
  text,
  uuid,
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
    ke.id,
    ke.content,
    ke.content_type,
    ke.source_id,
    ke.source_table,
    ke.meta,
    1 - (ke.embedding <=> query_embedding) as similarity,
    ke.created_at
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
