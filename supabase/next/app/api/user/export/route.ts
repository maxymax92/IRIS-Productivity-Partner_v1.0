import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [conversationsRes, knowledgeRes, semanticRes, remindersRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, title, summary, status, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('knowledge_embeddings')
      .select('id, content, content_type, source_id, source_table, meta, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('semantic_memory')
      .select('id, content, memory_type, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('reminders')
      .select('id, title, body, remind_at, status, created_at')
      .eq('user_id', user.id)
      .order('remind_at', { ascending: false }),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    conversations: conversationsRes.data ?? [],
    knowledgeMemory: knowledgeRes.data ?? [],
    semanticMemory: semanticRes.data ?? [],
    reminders: remindersRes.data ?? [],
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="iris-data-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
