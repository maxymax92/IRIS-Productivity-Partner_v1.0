import '@supabase/functions-js/edge-runtime.d.ts'
import { handleCors, requireAuth, success, created, noContent, errors, handleError, createLogger, createSupabaseClient } from '../_shared/index.ts'
import { generateEmbedding } from '../_shared/embeddings.ts'
import { ApiError } from '../_shared/errors.ts'

const log = createLogger('memory')

const MEMORY_COLUMNS = 'id, user_id, content, content_type, source_id, source_table, meta, created_at, updated_at'

const EMBEDDING_ERROR_MSG = 'Failed to generate embedding. Ensure Edge AI (gte-small) is enabled for your project.'

/** Cosine similarity threshold above which a new memory is considered a duplicate. */
const DEDUP_THRESHOLD = 0.85

/**
 * Shared dedup check — searches for a near-duplicate in either knowledge or episodic table.
 * Returns the matching row or null.
 */
async function checkForDuplicate(
  serviceClient: ReturnType<typeof createSupabaseClient>,
  rpcName: 'search_embeddings' | 'match_memories',
  embedding: number[],
  userId: string,
  extraArgs?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const baseArgs: Record<string, unknown> = rpcName === 'search_embeddings'
      ? { query_embedding: embedding, match_threshold: DEDUP_THRESHOLD, match_count: 1, filter_user_id: userId, filter_content_type: null }
      : { query_embedding: embedding, match_threshold: DEDUP_THRESHOLD, match_count: 1, p_user_id: userId }
    const args = { ...baseArgs, ...extraArgs }
    const { data: matches } = await serviceClient.rpc(rpcName, args)
    if (matches && matches.length > 0) return matches[0] as Record<string, unknown>
    return null
  } catch (err) {
    log.warn(`Dedup check (${rpcName}) failed, proceeding with insert`, err)
    return null
  }
}

async function getEmbeddingOrThrow(input: string): Promise<number[]> {
  try {
    const result = await generateEmbedding(input.trim())
    return result.embedding
  } catch (err) {
    log.error('Embedding generation failed', err)
    throw new ApiError('EMBEDDING_ERROR', EMBEDDING_ERROR_MSG, 500, { retryable: true })
  }
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response

    const { supabase, userId } = auth.ctx
    const serviceClient = createSupabaseClient()
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const lastSegment = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null

    // Detect /memory/semantic and /memory/semantic/:id paths
    const semanticIdx = pathParts.indexOf('semantic')
    const isSemantic = semanticIdx >= 0
    const semanticId = isSemantic && semanticIdx + 1 < pathParts.length ? pathParts[semanticIdx + 1] : null

    // POST /memory/search — semantic search across BOTH tables
    if (req.method === 'POST' && lastSegment === 'search') {
      const { query, contentType, limit, threshold, projectId } = await req.json()
      if (!query) return errors.badRequest('Missing query')

      const searchLimit = limit ?? 10
      const searchThreshold = threshold ?? 0.5
      const embedding = await getEmbeddingOrThrow(query)

      // search_embeddings: omit filter_project_id when null for backward compat with 5-param migration
      const searchArgs: Record<string, unknown> = {
        query_embedding: embedding,
        match_threshold: searchThreshold,
        match_count: searchLimit,
        filter_content_type: contentType ?? null,
        filter_user_id: userId,
      }
      if (projectId != null) searchArgs.filter_project_id = projectId

      const knowledgePromise = serviceClient.rpc('search_embeddings', searchArgs)

      // Search semantic_memory (episodic) — skip if filtering by knowledge-only types
      const knowledgeOnlyTypes = new Set(['file'])
      const skipEpisodic = contentType && knowledgeOnlyTypes.has(contentType)

      const episodicPromise = skipEpisodic
        ? Promise.resolve({ data: [] as unknown[], error: null })
        : (async () => {
            try {
              const matchArgs: Record<string, unknown> = {
                query_embedding: embedding,
                match_threshold: searchThreshold,
                match_count: searchLimit,
                p_user_id: userId,
              }
              if (projectId != null) matchArgs.p_project_id = projectId
              const res = await serviceClient.rpc('match_memories', matchArgs)
              if (res.error) {
                log.warn('match_memories RPC error', res.error)
                return { data: [] as unknown[], error: null }
              }
              return res
            } catch (err) {
              log.warn('match_memories failed (semantic_memory may not exist yet)', err)
              return { data: [] as unknown[], error: null }
            }
          })()

      const [knowledgeResult, episodicResult] = await Promise.all([knowledgePromise, episodicPromise])

      if (knowledgeResult.error) throw knowledgeResult.error

      // Normalize and merge results from both tables (consistent shape)
      const knowledgeRows = (knowledgeResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        content: row.content,
        content_type: row.content_type,
        similarity: row.similarity,
        source: 'knowledge' as const,
        created_at: row.created_at,
      }))
      const episodicRows = (episodicResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        content: row.content,
        content_type: row.memory_type,
        similarity: row.similarity,
        source: 'episodic' as const,
        created_at: row.created_at,
      }))

      const merged = [...knowledgeRows, ...episodicRows]
        .sort((a, b) => (b.similarity as number) - (a.similarity as number))
        .slice(0, searchLimit)

      return success(merged)
    }

    // POST /memory/context — store episodic memory in semantic_memory
    if (req.method === 'POST' && lastSegment === 'context') {
      const { content, memoryType, importance, expiresAt, sourceType, sourceId, metadata, projectId } = await req.json()
      if (!content) return errors.badRequest('Missing content')
      if (!memoryType) return errors.badRequest('Missing memoryType')

      const embedding = await getEmbeddingOrThrow(content)

      // Dedup: check for a near-duplicate episodic memory before inserting
      const duplicate = await checkForDuplicate(
        serviceClient, 'match_memories', embedding, userId,
        projectId != null ? { p_project_id: projectId } : undefined,
      )

      if (duplicate) {
        log.info(`Dedup: episodic memory matches existing ${duplicate.id} (similarity=${duplicate.similarity})`)
        const { data, error } = await serviceClient
          .from('semantic_memory')
          .update({
            content,
            embedding,
            memory_type: memoryType,
            importance: importance ?? 0.5,
            metadata: metadata ?? (duplicate.metadata as Record<string, unknown>) ?? {},
          })
          .eq('id', duplicate.id as string)
          .select('id, content, memory_type, importance, created_at')
          .single()
        if (error) throw error
        return success(data)
      }

      const { data, error } = await serviceClient.from('semantic_memory').insert({
        user_id: userId,
        content,
        embedding,
        memory_type: memoryType,
        importance: importance ?? 0.5,
        source_type: sourceType ?? null,
        source_id: sourceId ?? null,
        metadata: metadata ?? {},
        expires_at: expiresAt ?? null,
        project_id: projectId ?? null,
      }).select('id, content, memory_type, importance, created_at').single()
      if (error) throw error
      return created(data)
    }

    // POST /memory — store a new memory
    if (req.method === 'POST' && !lastSegment) {
      const { content, contentType, sourceId, sourceTable, meta, projectId } = await req.json()
      if (!content) return errors.badRequest('Missing content')

      const embedding = await getEmbeddingOrThrow(content)

      // Dedup: check for a near-duplicate knowledge memory before inserting
      const duplicate = await checkForDuplicate(
        serviceClient, 'search_embeddings', embedding, userId,
        {
          filter_content_type: contentType ?? 'memory',
          ...(projectId != null && { filter_project_id: projectId }),
        },
      )

      if (duplicate) {
        log.info(`Dedup: knowledge memory matches existing ${duplicate.id} (similarity=${duplicate.similarity})`)
        const { data, error } = await serviceClient
          .from('knowledge_embeddings')
          .update({
            content,
            embedding,
            meta: meta ?? (duplicate.meta as Record<string, unknown>) ?? {},
          })
          .eq('id', duplicate.id as string)
          .select()
          .single()
        if (error) throw error
        return success(data)
      }

      const { data, error } = await serviceClient.from('knowledge_embeddings').insert({
        user_id: userId,
        content,
        content_type: contentType ?? 'memory',
        source_id: sourceId ?? null,
        source_table: sourceTable ?? null,
        embedding,
        meta: meta ?? {},
        project_id: projectId ?? null,
      }).select().single()
      if (error) throw error
      return created(data)
    }

    // PATCH /memory/:id — update a knowledge memory (re-embeds if content changes)
    if (req.method === 'PATCH' && lastSegment && lastSegment !== 'search' && lastSegment !== 'context' && !isSemantic) {
      const body = await req.json()
      const updates: Record<string, unknown> = {}

      if (body.content) {
        updates.content = body.content
        updates.embedding = await getEmbeddingOrThrow(body.content as string)
      }
      if (body.contentType) updates.content_type = body.contentType
      if (body.meta !== undefined) updates.meta = body.meta
      if (body.projectId !== undefined) updates.project_id = body.projectId

      if (Object.keys(updates).length === 0) {
        return errors.badRequest('No fields to update')
      }

      const { data, error } = await serviceClient
        .from('knowledge_embeddings')
        .update(updates)
        .eq('id', lastSegment)
        .eq('user_id', userId)
        .select('id, content, content_type')
        .single()
      if (error) throw error
      return success(data)
    }

    // GET /memory — list memories (paginated, optional content_type filter)
    if (req.method === 'GET' && !lastSegment) {
      const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const contentType = url.searchParams.get('content_type')

      let query = supabase
        .from('knowledge_embeddings')
        .select(MEMORY_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (contentType) {
        query = query.eq('content_type', contentType)
      }

      const { data, error } = await query
      if (error) throw error
      return success(data)
    }

    // GET /memory/:id — single memory entry
    if (req.method === 'GET' && lastSegment && !isSemantic) {
      const { data, error } = await supabase
        .from('knowledge_embeddings')
        .select(MEMORY_COLUMNS)
        .eq('id', lastSegment)
        .eq('user_id', userId)
        .single()
      if (error) return errors.notFound('Memory not found')
      return success(data)
    }

    // DELETE /memory/:id
    if (req.method === 'DELETE' && lastSegment && !isSemantic) {
      await supabase
        .from('knowledge_embeddings')
        .delete()
        .eq('id', lastSegment)
        .eq('user_id', userId)
      return noContent()
    }

    // ── Semantic memory (episodic) CRUD ──────────────────────────────────

    const SEMANTIC_COLUMNS = 'id, user_id, content, memory_type, importance, source_type, source_id, metadata, created_at, updated_at'

    // GET /memory/semantic — list episodic memories (paginated)
    if (req.method === 'GET' && isSemantic && !semanticId) {
      const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const memoryType = url.searchParams.get('memory_type')

      let query = supabase
        .from('semantic_memory')
        .select(SEMANTIC_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (memoryType) {
        query = query.eq('memory_type', memoryType)
      }

      const { data, error } = await query
      if (error) throw error
      return success(data)
    }

    // GET /memory/semantic/:id — single episodic memory
    if (req.method === 'GET' && isSemantic && semanticId) {
      const { data, error } = await supabase
        .from('semantic_memory')
        .select(SEMANTIC_COLUMNS)
        .eq('id', semanticId)
        .eq('user_id', userId)
        .single()
      if (error) return errors.notFound('Semantic memory not found')
      return success(data)
    }

    // PATCH /memory/semantic/:id — update episodic memory (re-embeds if content changes)
    if (req.method === 'PATCH' && isSemantic && semanticId) {
      const body = await req.json()
      const updates: Record<string, unknown> = {}

      if (body.content) {
        updates.content = body.content
        updates.embedding = await getEmbeddingOrThrow(body.content as string)
      }
      if (body.memoryType) updates.memory_type = body.memoryType
      if (body.importance !== undefined) updates.importance = body.importance
      if (body.metadata !== undefined) updates.metadata = body.metadata

      if (Object.keys(updates).length === 0) {
        return errors.badRequest('No fields to update')
      }

      const { data, error } = await serviceClient
        .from('semantic_memory')
        .update(updates)
        .eq('id', semanticId)
        .eq('user_id', userId)
        .select('id, content, memory_type, importance')
        .single()
      if (error) throw error
      return success(data)
    }

    // DELETE /memory/semantic/:id
    if (req.method === 'DELETE' && isSemantic && semanticId) {
      await supabase
        .from('semantic_memory')
        .delete()
        .eq('id', semanticId)
        .eq('user_id', userId)
      return noContent()
    }

    return errors.notFound('Route not found')
  } catch (err) {
    log.error('Request failed', err)
    return handleError(err)
  }
})
