import '@supabase/functions-js/edge-runtime.d.ts'

import { withRetry } from './retry.ts'

interface EdgeAISession {
  run(input: string, options?: { mean_pool?: boolean; normalize?: boolean }): Promise<{
    data?: Float32Array | number[]
  } | Float32Array | number[]>
}

interface EdgeAI {
  Session: new (model: string) => EdgeAISession
}

declare const Supabase: { ai: EdgeAI }

let embeddingSession: EdgeAISession | null = null

export async function generateEmbedding(input: string): Promise<{ embedding: number[] }> {
  if (!embeddingSession) {
    embeddingSession = new Supabase.ai.Session('gte-small')
  }
  const session = embeddingSession
  const output = await withRetry(
    () => session.run(input.trim(), { mean_pool: true, normalize: true }),
    { label: 'embedding', maxAttempts: 3, minTimeout: 200 },
  )
  const rawOutput = 'data' in output && output.data ? output.data : output
  return { embedding: Array.from(rawOutput as ArrayLike<number>) }
}
