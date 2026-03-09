-- =============================================================================
-- Migration: Orphan Cleanup for knowledge_embeddings
-- Purpose: Automatically delete orphaned knowledge_embeddings where the linked
--          source record (note or task) no longer exists.
-- Note: Expired semantic_memory cleanup already handled by existing
--        'prune-expired-memories' cron job (0 3 * * *).
-- =============================================================================

-- pg_cron is already enabled on this project. Ensure grant for safety.
grant usage on schema cron to postgres;

-- =============================================================================
-- Weekly orphan cleanup for knowledge_embeddings
-- Removes embeddings whose source_id points to a deleted note or task.
-- Only targets rows that have a source_id set (non-null) AND a recognised
-- source_table ('notes' or 'tasks'). Runs Sundays at 04:00 UTC.
-- =============================================================================
select cron.schedule(
  'cleanup-orphaned-knowledge-embeddings',
  '0 4 * * 0',
  $$DELETE FROM public.knowledge_embeddings ke
    WHERE ke.source_id IS NOT NULL
      AND ke.source_table IS NOT NULL
      AND (
        (ke.source_table = 'notes'
         AND NOT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = ke.source_id))
        OR
        (ke.source_table = 'tasks'
         AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = ke.source_id))
      )$$
);
