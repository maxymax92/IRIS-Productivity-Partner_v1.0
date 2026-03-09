import { respondToApproval } from '@/lib/agent/approval-registry'
import { createClient } from '@/lib/supabase/server'

interface ApproveRequestBody {
  approvalId?: string
  approved?: boolean
  reason?: string
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return new Response('Unauthorized', { status: 401 })

  const body = (await request.json()) as ApproveRequestBody
  if (typeof body.approvalId !== 'string' || typeof body.approved !== 'boolean') {
    return new Response('Invalid request', { status: 400 })
  }

  const wasResolved = respondToApproval(body.approvalId, {
    approved: body.approved,
    ...(typeof body.reason === 'string' && { reason: body.reason }),
  })

  if (!wasResolved) {
    return Response.json({ ok: false, error: 'Approval not found or expired' }, { status: 404 })
  }

  return Response.json({ ok: true })
}
