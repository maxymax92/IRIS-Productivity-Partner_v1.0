-- =============================================================================
-- Migration: Harden security definer functions against user ID spoofing
-- Problem: Functions accepting p_user_id with coalesce(p_user_id, auth.uid())
--          allow any authenticated user to pass another user's ID.
-- Fix: Authenticated callers are forced to auth.uid(). Service-role callers
--      (where auth.uid() IS NULL) can still pass an explicit user ID.
-- =============================================================================

-- ── 1. increment_usage_stats ─────────────────────────────────────────────────

drop function if exists public.increment_usage_stats(integer, integer, integer, integer, uuid);

create or replace function public.increment_usage_stats(
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_api_calls integer default 0,
  p_session_time_seconds integer default 0,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- Authenticated callers always use their own ID (prevents spoofing).
  -- Service-role callers (auth.uid() is null) use the explicit parameter.
  if auth.uid() is not null then
    v_user_id := auth.uid();
  else
    v_user_id := p_user_id;
  end if;

  if v_user_id is null then
    return;
  end if;

  insert into public.usage_stats (
    user_id, stat_date,
    input_tokens, output_tokens, total_tokens,
    api_calls, total_session_time_seconds
  )
  values (
    v_user_id, current_date,
    p_input_tokens, p_output_tokens, p_input_tokens + p_output_tokens,
    p_api_calls, p_session_time_seconds
  )
  on conflict (user_id, stat_date)
  do update set
    input_tokens = usage_stats.input_tokens + p_input_tokens,
    output_tokens = usage_stats.output_tokens + p_output_tokens,
    total_tokens = usage_stats.total_tokens + p_input_tokens + p_output_tokens,
    api_calls = usage_stats.api_calls + p_api_calls,
    total_session_time_seconds = usage_stats.total_session_time_seconds + p_session_time_seconds,
    updated_at = now();
end;
$$;

grant execute on function public.increment_usage_stats to authenticated, service_role;

comment on function public.increment_usage_stats is
  'Upsert daily usage stats. Authenticated callers are scoped to auth.uid(). Service-role callers pass p_user_id explicitly.';

-- ── 2. search_embeddings ─────────────────────────────────────────────────────

drop function if exists public.search_embeddings(
  extensions.vector(384), float, int, text, uuid, uuid
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
declare
  v_user_id uuid;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  else
    v_user_id := filter_user_id;
  end if;

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
    ke.user_id = v_user_id
    and (filter_content_type is null or ke.content_type = filter_content_type)
    and (filter_project_id is null or ke.project_id = filter_project_id)
    and 1 - (ke.embedding <=> query_embedding) > match_threshold
  order by ke.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function public.search_embeddings to authenticated;

-- ── 3. match_memories ────────────────────────────────────────────────────────

-- Drop both overloaded signatures (4-param and 5-param)
drop function if exists public.match_memories(extensions.vector(384), float, int, uuid);
drop function if exists public.match_memories(extensions.vector(384), float, int, uuid, uuid);

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
declare
  v_user_id uuid;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  else
    v_user_id := p_user_id;
  end if;

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
    sm.user_id = v_user_id
    and (p_project_id is null or sm.project_id = p_project_id)
    and (sm.expires_at is null or sm.expires_at > now())
    and 1 - (sm.embedding <=> query_embedding) > match_threshold
  order by sm.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function public.match_memories to authenticated;

-- ── 4. get_or_create_session — harden + use auth.uid() ───────────────────────

create or replace function public.get_or_create_session(
  p_user_id uuid,
  p_model text default null,
  p_allowed_tools text[] default null
)
returns public.agent_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_session public.agent_sessions;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  else
    v_user_id := p_user_id;
  end if;

  select * into v_session
  from public.agent_sessions
  where user_id = v_user_id
    and status = 'active'
    and last_activity_at > now() - interval '24 hours'
  order by last_activity_at desc
  limit 1;

  if found then
    return v_session;
  end if;

  insert into public.agent_sessions (
    user_id, model, allowed_tools
  )
  values (
    v_user_id, p_model, coalesce(p_allowed_tools, '{}')
  )
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.get_or_create_session to authenticated, service_role;

-- ── 5. fork_session — harden + use auth.uid() ────────────────────────────────

create or replace function public.fork_session(
  p_parent_session_id uuid,
  p_user_id uuid
)
returns public.agent_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_parent public.agent_sessions;
  v_child public.agent_sessions;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  else
    v_user_id := p_user_id;
  end if;

  select * into v_parent
  from public.agent_sessions
  where id = p_parent_session_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Parent session not found or access denied';
  end if;

  insert into public.agent_sessions (
    user_id, parent_session_id, context_summary,
    model, allowed_tools, meta
  )
  values (
    v_user_id, p_parent_session_id, v_parent.context_summary,
    v_parent.model, v_parent.allowed_tools,
    v_parent.meta || jsonb_build_object('forked_from', p_parent_session_id)
  )
  returning * into v_child;

  return v_child;
end;
$$;

grant execute on function public.fork_session to authenticated, service_role;

-- ── 6. increment_message_count — add user scoping ────────────────────────────

create or replace function public.increment_message_count(
  p_conversation_id uuid,
  p_count int default 1
)
returns void
language sql
security invoker
set search_path = public
as $$
  update conversations
  set message_count = coalesce(message_count, 0) + p_count,
      updated_at = now()
  where id = p_conversation_id
    and user_id = auth.uid();
$$;

grant execute on function public.increment_message_count to authenticated;

comment on function public.increment_message_count is
  'Atomically increments message_count on a conversation row. Scoped to auth.uid().';
