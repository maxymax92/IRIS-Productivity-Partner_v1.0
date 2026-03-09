-- Deduplicate knowledge_embeddings rows with duplicate (user_id, source_id)
-- Keep the most recently updated row for each duplicate set
DELETE FROM knowledge_embeddings ke
WHERE ke.source_id IS NOT NULL
  AND ke.id NOT IN (
    SELECT DISTINCT ON (user_id, source_id) id
    FROM knowledge_embeddings
    WHERE source_id IS NOT NULL
    ORDER BY user_id, source_id, updated_at DESC
  );

-- Add full unique constraint to prevent future duplicates.
-- Uses a proper CONSTRAINT (not a partial index) so PostgREST's
-- onConflict parameter can match it for upsert operations.
-- SQL standard: NULL != NULL, so rows where source_id IS NULL
-- will never conflict with each other.
ALTER TABLE knowledge_embeddings
  ADD CONSTRAINT uq_knowledge_embeddings_user_source
  UNIQUE (user_id, source_id);
