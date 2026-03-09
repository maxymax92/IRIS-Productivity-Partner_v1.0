/**
 * In-memory registry for pending tool approval requests.
 *
 * When the Agent SDK's PermissionRequest hook fires, it writes a
 * `tool-approval-request` event to the UI stream and blocks on a
 * Promise stored here. The `/api/chat/approve` endpoint resolves
 * that Promise when the user approves or denies.
 */

interface PendingApproval {
  resolve: (response: { approved: boolean; reason?: string }) => void
  timeout: ReturnType<typeof setTimeout>
}

const pendingApprovals = new Map<string, PendingApproval>()

/** How long to wait before auto-denying an unanswered approval request. */
const APPROVAL_TIMEOUT_MS = 120_000

/**
 * Register a pending approval and return a Promise that resolves
 * when the user responds (or times out after 2 minutes).
 */
export async function requestApproval(
  approvalId: string,
): Promise<{ approved: boolean; reason?: string }> {
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(approvalId)
      resolve({ approved: false, reason: 'Approval timed out' })
    }, APPROVAL_TIMEOUT_MS)

    pendingApprovals.set(approvalId, { resolve, timeout })
  })
}

/**
 * Resolve a pending approval. Returns `true` if the approval was
 * found and resolved, `false` if it was already resolved or expired.
 */
export function respondToApproval(
  approvalId: string,
  response: { approved: boolean; reason?: string },
): boolean {
  const pending = pendingApprovals.get(approvalId)
  if (!pending) return false

  clearTimeout(pending.timeout)
  pendingApprovals.delete(approvalId)
  pending.resolve(response)
  return true
}
