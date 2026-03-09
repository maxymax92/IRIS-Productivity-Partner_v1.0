import { GIT_LOG_DEFAULT_LIMIT } from '@/lib/constants'
import { createAdminClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitFile {
  path: string
  action: 'add' | 'modify' | 'delete'
  size?: number
  contentType?: string
}

export interface Commit {
  id: string
  message: string
  createdAt: string
  fileCount: number
}

export interface CommitDetail {
  id: string
  message: string
  createdAt: string
  files: Array<{
    path: string
    action: string
    size: number | null
    contentType: string | null
  }>
}

// ---------------------------------------------------------------------------
// createFileCommit — shared by /api/user/files and agent manageFileHandler
// ---------------------------------------------------------------------------

export async function createFileCommit(opts: {
  userId: string
  message: string
  files: CommitFile[]
  adminClient?: ReturnType<typeof createAdminClient>
}): Promise<{ commitId: string } | { error: string }> {
  const supabase = opts.adminClient ?? createAdminClient()

  // 1. Insert the commit
  const { data: commit, error: commitError } = await supabase
    .from('file_commits')
    .insert({
      user_id: opts.userId,
      message: opts.message,
    })
    .select('id')
    .single()

  if (commitError) {
    return { error: `Failed to create commit: ${commitError.message}` }
  }

  // 2. Insert commit files
  const commitId = commit.id
  const fileRows = opts.files.map((f) => ({
    commit_id: commitId,
    path: f.path,
    action: f.action,
    size: f.size ?? null,
    content_type: f.contentType ?? null,
  }))

  const { error: filesError } = await supabase.from('file_commit_files').insert(fileRows)

  if (filesError) {
    return { error: `Failed to record commit files: ${filesError.message}` }
  }

  return { commitId }
}

// ---------------------------------------------------------------------------
// getCommitLog — recent commits for a user
// ---------------------------------------------------------------------------

interface CommitLogRow {
  id: string
  message: string
  created_at: string
  file_commit_files: Array<{ id: string }>
}

export async function getCommitLog(
  userId: string,
  limit = GIT_LOG_DEFAULT_LIMIT,
  adminClient?: ReturnType<typeof createAdminClient>,
): Promise<Commit[]> {
  const supabase = adminClient ?? createAdminClient()

  const { data, error } = await supabase
    .from('file_commits')
    .select('id, message, created_at, file_commit_files(id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<CommitLogRow[]>()

  if (error) {
    console.error('[commits] getCommitLog failed:', error.message)
    return []
  }

  return data.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
    fileCount: row.file_commit_files.length,
  }))
}

// ---------------------------------------------------------------------------
// getCommitDetail — files changed in a specific commit
// ---------------------------------------------------------------------------

interface CommitDetailRow {
  id: string
  message: string
  created_at: string
  file_commit_files: Array<{
    path: string
    action: string
    size: number | null
    content_type: string | null
  }>
}

export async function getCommitDetail(
  commitId: string,
  userId: string,
  adminClient?: ReturnType<typeof createAdminClient>,
): Promise<CommitDetail | null> {
  const supabase = adminClient ?? createAdminClient()

  const { data, error } = await supabase
    .from('file_commits')
    .select('id, message, created_at, file_commit_files(path, action, size, content_type)')
    .eq('id', commitId)
    .eq('user_id', userId)
    .single<CommitDetailRow>()

  if (error) {
    console.error('[commits] getCommitDetail failed:', error.message)
    return null
  }

  return {
    id: data.id,
    message: data.message,
    createdAt: data.created_at,
    files: data.file_commit_files.map((f) => ({
      path: f.path,
      action: f.action,
      size: f.size,
      contentType: f.content_type,
    })),
  }
}
