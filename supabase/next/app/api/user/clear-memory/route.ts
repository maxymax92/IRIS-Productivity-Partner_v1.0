import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [semanticRes, embeddingsRes] = await Promise.all([
    supabase.from('semantic_memory').delete().eq('user_id', user.id),
    supabase.from('knowledge_embeddings').delete().eq('user_id', user.id),
  ])

  if (semanticRes.error) {
    return NextResponse.json({ error: semanticRes.error.message }, { status: 500 })
  }
  if (embeddingsRes.error) {
    return NextResponse.json({ error: embeddingsRes.error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
