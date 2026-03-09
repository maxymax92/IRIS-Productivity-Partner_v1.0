-- =============================================================================
-- Migration: Core schema tables, enums, and RLS policies
-- Purpose: These tables were originally created via the Supabase dashboard.
--          This migration commits them so self-hosted deployments get the
--          full schema from `supabase db push`.
-- Note: Uses IF NOT EXISTS / DO blocks so it's safe to run on existing DBs.
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

do $$ begin
  create type public.conversation_status as enum ('active', 'archived', 'deleted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.message_role as enum ('user', 'assistant', 'system', 'tool');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_type as enum ('reminder', 'task_due', 'mention', 'system', 'achievement');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.reminder_status as enum ('pending', 'sent', 'dismissed', 'snoozed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

-- ── Tables (dependency order) ────────────────────────────────────────────────

-- 1. users — referenced by almost everything
create table if not exists public.users (
  id uuid primary key,  -- matches auth.users.id
  email text not null,
  full_name text,
  avatar_url text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. projects — referenced by conversations, tasks, notes, reminders
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  slug text,
  workspace_path text not null,
  github_url text,
  github_default_branch text,
  is_git_linked boolean default false,
  settings jsonb,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text,
  summary text,
  status public.conversation_status default 'active',
  message_count integer default 0,
  sdk_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. conversation_messages
create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.message_role not null,
  content text not null,
  model_id text,
  tokens_used integer,
  attachments jsonb,
  tool_calls jsonb,
  metadata jsonb,
  is_complete boolean default true,
  created_at timestamptz not null default now()
);

-- 5. tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text,
  status public.task_status default 'pending',
  priority public.task_priority default 'medium',
  due_date date,
  due_time time,
  completed_at timestamptz,
  reminder_at timestamptz,
  recurrence_rule text,
  section text,
  sort_order integer default 0,
  tags text[],
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. notes
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'Untitled',
  content jsonb default '{}',
  content_text text,
  folder_path text,
  tags text[],
  is_pinned boolean default false,
  is_archived boolean default false,
  version_number integer default 1,
  word_count integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. note_versions
create table if not exists public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  content jsonb not null,
  content_text text,
  version_number integer not null,
  change_summary text,
  created_at timestamptz not null default now()
);

-- 8. reminders
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  note_id uuid references public.notes(id) on delete set null,
  title text not null,
  body text,
  remind_at timestamptz not null,
  status public.reminder_status default 'pending',
  snoozed_until timestamptz,
  snooze_count integer default 0,
  recurrence_rule text,
  next_occurrence timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 9. notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  source_type text,
  source_id uuid,
  action_url text,
  metadata jsonb,
  is_read boolean default false,
  read_at timestamptz,
  push_sent boolean default false,
  push_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 10. push_subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- 11. usage_stats
create table if not exists public.usage_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stat_date date not null default current_date,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  api_calls integer not null default 0,
  session_count integer not null default 0,
  tool_calls integer not null default 0,
  rate_limit_hits integer not null default 0,
  total_session_time_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stat_date)
);

-- 12. user_settings
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  theme text default 'system',
  language text default 'en',
  timezone text,
  date_format text default 'DD/MM/YYYY',
  time_format text default '24h',
  model_id text,
  extended_thinking boolean default false,
  max_output_tokens integer,
  ai_personality text,
  ai_proactivity boolean default true,
  notifications_enabled boolean default true,
  email_notifications boolean default true,
  push_notifications boolean default false,
  analytics_enabled boolean default true,
  active_tab text,
  active_conversation_id uuid references public.conversations(id) on delete set null,
  active_note_id uuid references public.notes(id) on delete set null,
  task_sidebar_filter text,
  notes_tag_filter text,
  features jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 13. rate_limit_buckets
create table if not exists public.rate_limit_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  bucket_key text not null,
  tokens integer not null default 10,
  max_tokens integer not null default 10,
  refill_rate integer not null default 1,
  last_refill timestamptz not null default now(),
  unique (user_id, bucket_key)
);

-- 14. agent_audit_log
create table if not exists public.agent_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid,
  tool_name text not null,
  tool_input jsonb,
  tool_output jsonb,
  error_message text,
  execution_time_ms integer,
  permission_decision text,
  permission_reason text,
  created_at timestamptz not null default now()
);

-- 15. rooms (for real-time messaging)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- 16. room_members
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- 17. messages (room messages)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists idx_conversations_user_id on public.conversations(user_id);
create index if not exists idx_conversations_updated_at on public.conversations(updated_at desc);
create index if not exists idx_conversation_messages_conversation_id on public.conversation_messages(conversation_id);
create index if not exists idx_conversation_messages_user_id on public.conversation_messages(user_id);
create index if not exists idx_tasks_user_id on public.tasks(user_id);
create index if not exists idx_tasks_status on public.tasks(user_id, status);
create index if not exists idx_notes_user_id on public.notes(user_id);
create index if not exists idx_note_versions_note_id on public.note_versions(note_id);
create index if not exists idx_reminders_user_id on public.reminders(user_id);
create index if not exists idx_reminders_status on public.reminders(user_id, status);
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_unread on public.notifications(user_id, is_read) where is_read = false;
create index if not exists idx_usage_stats_user_date on public.usage_stats(user_id, stat_date);
create index if not exists idx_agent_audit_log_user_id on public.agent_audit_log(user_id);
create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions(user_id);
create index if not exists idx_messages_room_id on public.messages(room_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.note_versions enable row level security;
alter table public.reminders enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.usage_stats enable row level security;
alter table public.user_settings enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.agent_audit_log enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- ── RLS Policies (all scoped to auth.uid()) ──────────────────────────────────

-- Helper: DO block to create policies idempotently
-- (CREATE POLICY has no IF NOT EXISTS, so we use exception handling)

-- users: own row only
do $$ begin
  create policy "users_select_own" on public.users for select using (id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "users_update_own" on public.users for update using (id = auth.uid());
exception when duplicate_object then null;
end $$;

-- projects
do $$ begin
  create policy "projects_select_own" on public.projects for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "projects_insert_own" on public.projects for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "projects_update_own" on public.projects for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "projects_delete_own" on public.projects for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- conversations
do $$ begin
  create policy "conversations_select_own" on public.conversations for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversations_insert_own" on public.conversations for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversations_update_own" on public.conversations for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversations_delete_own" on public.conversations for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- conversation_messages
do $$ begin
  create policy "conversation_messages_select_own" on public.conversation_messages for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversation_messages_insert_own" on public.conversation_messages for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversation_messages_update_own" on public.conversation_messages for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "conversation_messages_delete_own" on public.conversation_messages for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- tasks
do $$ begin
  create policy "tasks_select_own" on public.tasks for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "tasks_insert_own" on public.tasks for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "tasks_update_own" on public.tasks for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "tasks_delete_own" on public.tasks for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- notes
do $$ begin
  create policy "notes_select_own" on public.notes for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notes_insert_own" on public.notes for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notes_update_own" on public.notes for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notes_delete_own" on public.notes for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- note_versions
do $$ begin
  create policy "note_versions_select_own" on public.note_versions for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "note_versions_insert_own" on public.note_versions for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- reminders
do $$ begin
  create policy "reminders_select_own" on public.reminders for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "reminders_insert_own" on public.reminders for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "reminders_update_own" on public.reminders for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "reminders_delete_own" on public.reminders for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- notifications
do $$ begin
  create policy "notifications_select_own" on public.notifications for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notifications_insert_own" on public.notifications for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notifications_update_own" on public.notifications for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "notifications_delete_own" on public.notifications for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- push_subscriptions
do $$ begin
  create policy "push_subscriptions_select_own" on public.push_subscriptions for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "push_subscriptions_insert_own" on public.push_subscriptions for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- usage_stats
do $$ begin
  create policy "usage_stats_select_own" on public.usage_stats for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- user_settings
do $$ begin
  create policy "user_settings_select_own" on public.user_settings for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "user_settings_insert_own" on public.user_settings for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "user_settings_update_own" on public.user_settings for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- rate_limit_buckets
do $$ begin
  create policy "rate_limit_buckets_select_own" on public.rate_limit_buckets for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "rate_limit_buckets_insert_own" on public.rate_limit_buckets for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "rate_limit_buckets_update_own" on public.rate_limit_buckets for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- agent_audit_log
do $$ begin
  create policy "agent_audit_log_select_own" on public.agent_audit_log for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "agent_audit_log_insert_own" on public.agent_audit_log for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- rooms / room_members / messages — membership-scoped
do $$ begin
  create policy "rooms_select_member" on public.rooms for select using (
    exists (select 1 from public.room_members rm where rm.room_id = id and rm.user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "room_members_select_own" on public.room_members for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "messages_select_member" on public.messages for select using (
    exists (select 1 from public.room_members rm where rm.room_id = messages.room_id and rm.user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "messages_insert_member" on public.messages for insert with check (
    user_id = auth.uid() and
    exists (select 1 from public.room_members rm where rm.room_id = messages.room_id and rm.user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

-- ── Utility functions ────────────────────────────────────────────────────────

-- get_or_create_user_settings: upserts user settings row
create or replace function public.get_or_create_user_settings(p_user_id uuid)
returns setof public.user_settings
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only allow users to access their own settings
  if auth.uid() is not null and auth.uid() != p_user_id then
    raise exception 'Access denied';
  end if;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return query select * from public.user_settings where user_id = p_user_id;
end;
$$;

grant execute on function public.get_or_create_user_settings to authenticated, service_role;
