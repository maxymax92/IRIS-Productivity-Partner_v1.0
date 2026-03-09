import '@supabase/functions-js/edge-runtime.d.ts'
import { generateEmbedding } from '../_shared/embeddings.ts'
import { handleCors, requireAuth, success, errors, handleError } from '../_shared/index.ts'

Deno.serve(async (req) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response

    const { text } = await req.json() as { text?: string }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return errors.badRequest('text field is required and must be a non-empty string')
    }

    const { embedding } = await generateEmbedding(text)
    return success({ embedding })
  } catch (err) {
    return handleError(err)
  }
})
