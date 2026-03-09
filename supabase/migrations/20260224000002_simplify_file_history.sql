-- =============================================================================
-- Migration: Simplify File History
-- Purpose: Remove over-engineered git-like infrastructure (branching, linked list)
-- Context: Desktop app will use real git via dugite; web only needs an audit trail
-- =============================================================================

-- Drop file_refs table (branching infrastructure — never used beyond single "main" ref)
-- All policies, indexes, and FK constraints are dropped automatically with CASCADE
drop table if exists public.file_refs cascade;

-- Drop parent_id column from file_commits (linked list never traversed — getCommitLog
-- uses ORDER BY created_at DESC, never walks the chain)
alter table public.file_commits drop column if exists parent_id;

-- Update table comment to reflect actual purpose
comment on table public.file_commits is
  'File activity log. Each row groups related file operations (uploads, deletes) for audit history.';
