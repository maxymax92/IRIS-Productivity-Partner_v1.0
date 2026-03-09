-- =============================================================================
-- Migration: Add increment_message_count RPC
-- Purpose: Atomic message count increment for conversations (avoids race conditions)
-- =============================================================================

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
  where id = p_conversation_id;
$$;

grant execute on function public.increment_message_count to authenticated;

comment on function public.increment_message_count is
  'Atomically increments message_count on a conversation row';
