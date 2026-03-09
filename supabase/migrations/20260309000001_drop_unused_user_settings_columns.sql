-- =============================================================================
-- Migration: Drop unused user_settings columns
-- Purpose: Remove columns that have no application code reading or writing them
--   - analytics_enabled: no analytics system implemented
--   - ai_proactivity: no agent behaviour tied to it
--   - theme: app hardcodes dark mode
--   - email_notifications: no email delivery system implemented
-- =============================================================================

ALTER TABLE user_settings
  DROP COLUMN IF EXISTS analytics_enabled,
  DROP COLUMN IF EXISTS ai_proactivity,
  DROP COLUMN IF EXISTS theme,
  DROP COLUMN IF EXISTS email_notifications;
