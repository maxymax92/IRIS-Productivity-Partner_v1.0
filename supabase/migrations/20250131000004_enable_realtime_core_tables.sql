-- Migration: Enable Realtime on Core Tables
-- Phase 6: Core App Realtime Rollout
--
-- This migration adds core application tables to the supabase_realtime publication
-- to enable real-time updates via Postgres Changes.
--
-- Tables enabled:
--   - tasks: Real-time task status changes, assignments
--   - notes: Content sync, collaborative editing
--   - conversation_messages: Instant message delivery
--   - notifications: Real-time notification alerts
--   - reminders: Reminder triggers and snooze sync
--   - projects: Project updates and member activity
--
-- Prerequisites:
--   - All tables must have RLS enabled (already done)
--   - supabase_realtime publication must exist (created by Supabase)
--
-- Note: Realtime respects RLS policies, so users will only receive
-- changes for rows they have SELECT access to.

-- =============================================================================
-- Enable Realtime on Core Tables
-- =============================================================================

-- Add tasks table to realtime publication
-- Use case: Task status changes, assignments, real-time sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

-- Add notes table to realtime publication
-- Use case: Auto-save sync across devices, collaborative editing
ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;

-- Add conversation_messages table to realtime publication
-- Use case: Instant message delivery, read receipts
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;

-- Add notifications table to realtime publication
-- Use case: Instant notification delivery, read state sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Add reminders table to realtime publication
-- Use case: Real-time reminder alerts, snooze sync across devices
ALTER PUBLICATION supabase_realtime ADD TABLE public.reminders;

-- Add projects table to realtime publication
-- Use case: Real-time project changes, progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- =============================================================================
-- Enable REPLICA IDENTITY FULL for tables that need old record data
-- =============================================================================
-- This allows UPDATE and DELETE events to include the previous row data,
-- which is useful for:
--   - Showing what changed (diff view)
--   - Conflict resolution in collaborative editing
--   - Audit logging on the client side
--
-- Note: This slightly increases WAL size but is necessary for full
-- real-time functionality. Only enable on tables where you need old data.

-- Enable REPLICA IDENTITY FULL on notes for collaborative editing
-- (need to see what content was before the update)
ALTER TABLE public.notes REPLICA IDENTITY FULL;

-- Enable REPLICA IDENTITY FULL on tasks for change tracking
-- (useful for showing "Task X was changed from Y to Z")
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

-- Enable REPLICA IDENTITY FULL on conversation_messages
-- (useful for edit history and message corrections)
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;

-- =============================================================================
-- Verification Comment
-- =============================================================================
-- To verify this migration worked, run:
--   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--
-- Expected output should include:
--   public.tasks
--   public.notes
--   public.conversation_messages
--   public.notifications
--   public.reminders
--   public.projects
