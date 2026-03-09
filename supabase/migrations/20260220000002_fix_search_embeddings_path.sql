-- =============================================================================
-- Migration: Fix search_embeddings search_path
-- Purpose: Include extensions schema so pgvector operators (<=> etc.) are found
-- =============================================================================

create or replace function public.search_embeddings(
  query_embedding extensions.vector(384),
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
    and 1 - (ke.embedding <=> query_embedding) > match_threshold
  order by ke.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function public.search_embeddings to authenticated;
