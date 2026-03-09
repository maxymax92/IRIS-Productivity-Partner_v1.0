-- =============================================================================
-- Migration: Agent Sessions Table
-- Purpose: Track Claude Agent SDK sessions for conversation continuity
-- =============================================================================

-- =============================================================================
-- Enum Types
-- =============================================================================

-- Session status enum
create type public.session_status as enum (
  'active',      -- Session is currently active
  'paused',      -- Session is paused (can be resumed)
  'completed',   -- Session ended normally
  'expired',     -- Session expired due to inactivity
  'error'        -- Session ended due to an error
);

-- =============================================================================
-- Table: agent_sessions
-- =============================================================================
-- Tracks conversation sessions with the Claude Agent SDK
-- Enables session resumption, forking, and context preservation

create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- SDK Integration
  sdk_session_id text,                            -- Session ID from Claude Agent SDK
  parent_session_id uuid references public.agent_sessions(id),  -- For forked sessions

  -- Session State
  status public.session_status not null default 'active',
  title text,                                     -- Optional user-friendly title
  context_summary text,                           -- AI-generated summary of conversation context

  -- Metrics
  message_count int not null default 0,           -- Number of messages in session
  token_count int default 0,                      -- Estimated tokens used
  turn_count int not null default 0,              -- Number of agent turns

  -- Configuration
  model text,                                     -- Model used for this session
  allowed_tools text[] default '{}',              -- Tools enabled for this session

  -- Flexible metadata
  meta jsonb default '{}'::jsonb,                 -- Additional metadata (tags, preferences, etc.)

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz                        -- When session was completed/expired
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Primary lookup: user's sessions
create index idx_agent_sessions_user
  on public.agent_sessions(user_id, created_at desc);

-- Active sessions for a user (most common query)
create index idx_agent_sessions_user_active
  on public.agent_sessions(user_id)
  where status = 'active';

-- SDK session ID lookup (for resume operations)
create unique index idx_agent_sessions_sdk_id
  on public.agent_sessions(sdk_session_id)
  where sdk_session_id is not null;

-- Parent session lookup (for fork tree queries)
create index idx_agent_sessions_parent
  on public.agent_sessions(parent_session_id)
  where parent_session_id is not null;

-- Recent activity lookup
create index idx_agent_sessions_activity
  on public.agent_sessions(user_id, last_activity_at desc);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.agent_sessions enable row level security;

-- Policy: Users can only access their own sessions
create policy "Users can view own sessions"
  on public.agent_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own sessions"
  on public.agent_sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own sessions"
  on public.agent_sessions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own sessions"
  on public.agent_sessions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- Functions
-- =============================================================================

-- Get or create an active session for a user
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
  v_session public.agent_sessions;
begin
  -- First, try to find an existing active session from the last 24 hours
  select * into v_session
  from public.agent_sessions
  where user_id = p_user_id
    and status = 'active'
    and last_activity_at > now() - interval '24 hours'
  order by last_activity_at desc
  limit 1;

  -- If found, return it
  if found then
    return v_session;
  end if;

  -- Otherwise, create a new session
  insert into public.agent_sessions (
    user_id,
    model,
    allowed_tools
  )
  values (
    p_user_id,
    p_model,
    coalesce(p_allowed_tools, '{}')
  )
  returning * into v_session;

  return v_session;
end;
$$;

-- Fork a session (create a child session from a parent)
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
  v_parent public.agent_sessions;
  v_child public.agent_sessions;
begin
  -- Get the parent session
  select * into v_parent
  from public.agent_sessions
  where id = p_parent_session_id
    and user_id = p_user_id;

  if not found then
    raise exception 'Parent session not found or access denied';
  end if;

  -- Create the forked session
  insert into public.agent_sessions (
    user_id,
    parent_session_id,
    context_summary,
    model,
    allowed_tools,
    meta
  )
  values (
    p_user_id,
    p_parent_session_id,
    v_parent.context_summary,
    v_parent.model,
    v_parent.allowed_tools,
    v_parent.meta || jsonb_build_object('forked_from', p_parent_session_id)
  )
  returning * into v_child;

  return v_child;
end;
$$;

-- Update session activity (called after each message)
create or replace function public.update_session_activity(
  p_session_id uuid,
  p_sdk_session_id text default null,
  p_increment_messages int default 1,
  p_increment_turns int default 0,
  p_token_delta int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_sessions
  set
    sdk_session_id = coalesce(p_sdk_session_id, sdk_session_id),
    message_count = message_count + p_increment_messages,
    turn_count = turn_count + p_increment_turns,
    token_count = coalesce(token_count, 0) + p_token_delta,
    last_activity_at = now(),
    updated_at = now()
  where id = p_session_id
    and user_id = auth.uid();
end;
$$;

-- Grant execute permissions
grant execute on function public.get_or_create_session to authenticated;
grant execute on function public.fork_session to authenticated;
grant execute on function public.update_session_activity to authenticated;

-- =============================================================================
-- Triggers
-- =============================================================================

-- Auto-update updated_at timestamp
create or replace function public.update_session_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_agent_sessions_updated
  before update on public.agent_sessions
  for each row
  execute function public.update_session_timestamp();

-- Auto-expire old sessions (runs on insert to check for stale sessions)
create or replace function public.expire_old_sessions()
returns trigger
language plpgsql
as $$
begin
  -- Mark sessions inactive for more than 7 days as expired
  update public.agent_sessions
  set
    status = 'expired',
    completed_at = now()
  where user_id = new.user_id
    and status = 'active'
    and last_activity_at < now() - interval '7 days';

  return new;
end;
$$;

create trigger trg_agent_sessions_expire_old
  after insert on public.agent_sessions
  for each row
  execute function public.expire_old_sessions();

-- =============================================================================
-- Comments
-- =============================================================================

comment on table public.agent_sessions is
  'Tracks Claude Agent SDK conversation sessions for continuity and context preservation';

comment on column public.agent_sessions.sdk_session_id is
  'Session ID returned by Claude Agent SDK, used for resume operations';

comment on column public.agent_sessions.parent_session_id is
  'Reference to parent session when this session was forked';

comment on column public.agent_sessions.context_summary is
  'AI-generated summary of the conversation context for quick reference';

comment on function public.get_or_create_session is
  'Gets an existing active session or creates a new one for the user';

comment on function public.fork_session is
  'Creates a new session branched from an existing parent session';

comment on function public.update_session_activity is
  'Updates session metrics after each agent interaction';
