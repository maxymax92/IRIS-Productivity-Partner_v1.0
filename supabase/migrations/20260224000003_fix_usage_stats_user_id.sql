-- =============================================================================
-- Migration: Add p_user_id parameter to increment_usage_stats
-- Purpose: Service-role calls have auth.uid() = null, so usage stats were
--          never recorded. Adding explicit p_user_id with COALESCE fallback.
-- =============================================================================

-- Drop the old function signature first (can't alter parameter list in-place)
drop function if exists public.increment_usage_stats(integer, integer, integer, integer);

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
  v_user_id := coalesce(p_user_id, auth.uid());
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
  'Upsert daily usage stats. Pass p_user_id explicitly for service-role calls (auth.uid() is null).';
