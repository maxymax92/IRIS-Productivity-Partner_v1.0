-- =============================================================================
-- Migration: pg_cron job for reminder-check edge function
-- Purpose: Automatically process due reminders every 2 minutes by calling
--          the reminder-check edge function via pg_net HTTP POST.
-- =============================================================================

-- pg_net enables HTTP requests from within Postgres (used by pg_cron jobs).
create extension if not exists pg_net with schema extensions;

-- Grant cron usage (idempotent — already granted in earlier migration).
grant usage on schema cron to postgres;

-- Remove existing job if present (idempotent).
select cron.unschedule('fire-due-reminders')
  where exists (select 1 from cron.job where jobname = 'fire-due-reminders');

-- Schedule reminder-check to run every 2 minutes.
-- Uses the service-role key exposed via current_setting on Supabase hosted.
select cron.schedule(
  'fire-due-reminders',
  '*/2 * * * *',
  $$
  select net.http_post(
    url    := current_setting('supabase.url') || '/functions/v1/reminder-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    ),
    body   := '{"source":"pg_cron"}'::jsonb
  );
  $$
);
