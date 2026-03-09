import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  DEFAULT_IMPORTANCE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SIMILARITY_THRESHOLD,
  MAX_FILE_LIST,
  MAX_PREVIEW_LENGTH,
  MAX_REMINDER_LIST_SIZE,
  MAX_SEARCH_RESULTS,
} from './prompt'

import { MS_PER_DAY, MS_PER_MINUTE } from '@/lib/constants'
import { serverEnv } from '@/lib/env'
import { createFileCommit } from '@/lib/files/commits'
import { formatRelativeAge } from '@/lib/format'
import type { Database } from '@/types/database.types'

export type AdminClient = SupabaseClient<Database>

/** Shared admin client factory — used for file storage and hooks */
export function createAgentAdminClient(): AdminClient {
  return createClient<Database>(serverEnv.SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FILE_BUCKET = 'user-files'

// ── Tool names exported for hooks and subagents ───────────────────────────────

export const IRIS_TOOL_NAMES = [
  'mcp__iris-tools__search_knowledge',
  'mcp__iris-tools__store_memory',
  'mcp__iris-tools__update_memory',
  'mcp__iris-tools__delete_memory',
  'mcp__iris-tools__log_context',
  'mcp__iris-tools__manage_file',
  'mcp__iris-tools__manage_project',
  'mcp__iris-tools__manage_reminder',
  'mcp__iris-tools__send_notification',
] as const

const BASE_ALLOWED_TOOLS = ['WebSearch', 'WebFetch', 'Task']

export const DEFAULT_ALLOWED_TOOLS = [...BASE_ALLOWED_TOOLS, ...IRIS_TOOL_NAMES]

// ── Types ─────────────────────────────────────────────────────────────────────

type ToolResponse = { content: Array<{ type: 'text'; text: string }> }

// ── Edge function caller ──────────────────────────────────────────────────────

interface EdgeResult<T = unknown> {
  data: T | null
  error?: string
}

/**
 * Call a Supabase Edge Function with the user's JWT.
 * Routes all CRUD through the single-source-of-truth edge functions,
 * which handle business logic (version history, embeddings, RLS).
 */
async function callEdge<T = unknown>(
  path: string,
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<EdgeResult<T>> {
  const url = `${serverEnv.SUPABASE_URL}/functions/v1/${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (res.status === 204) return { data: null }

  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { data: null, error: `Edge function returned ${String(res.status)} (non-JSON response)` }
  }

  if (!res.ok) {
    const errObj = json['error']
    let errMsg: string
    if (typeof errObj === 'object' && errObj !== null && 'message' in errObj) {
      errMsg = String((errObj as { message: unknown }).message)
    } else if (typeof json['message'] === 'string') {
      errMsg = json['message']
    } else {
      errMsg = String(errObj ?? `Edge function returned ${String(res.status)}`)
    }
    return { data: null, error: errMsg }
  }

  return { data: (json['data'] as T) ?? null }
}

function textResponse(msg: string): ToolResponse {
  return { content: [{ type: 'text', text: msg }] }
}

// ── Knowledge / Memory handlers (via memory edge function) ────────────────────

interface SearchRow {
  id: string
  content: string
  content_type: string
  similarity: number
  source: string
  created_at: string
}

async function searchKnowledgeHandler(
  accessToken: string,
  args: {
    query: string
    contentType?: string
    limit?: number
    threshold?: number
    projectId?: string
  },
): Promise<ToolResponse> {
  const searchLimit = args.limit ?? DEFAULT_SEARCH_LIMIT

  const { data, error } = await callEdge<SearchRow[]>('memory/search', 'POST', accessToken, {
    query: args.query,
    ...(args.contentType !== undefined && { contentType: args.contentType }),
    limit: searchLimit,
    threshold: args.threshold ?? DEFAULT_SIMILARITY_THRESHOLD,
    ...(args.projectId !== undefined && { projectId: args.projectId }),
  })

  if (error) return textResponse(`Search failed: ${error}`)
  if (!data || data.length === 0) return textResponse('No matching results found.')

  const formatted = data
    .map((item, i) => {
      const sim = (item.similarity * 100).toFixed(1)
      const preview = item.content.substring(0, MAX_PREVIEW_LENGTH)
      const ellipsis = item.content.length > MAX_PREVIEW_LENGTH ? '…' : ''
      const src = item.source
      const age = item.created_at ? formatRelativeAge(item.created_at) : 'unknown'
      return `${String(i + 1)}. [${item.content_type}] (${sim}% match, ${age}, id: ${item.id}, source: ${src})\n   ${preview}${ellipsis}`
    })
    .join('\n\n')

  return textResponse(`Found ${String(data.length)} results:\n\n${formatted}`)
}

async function storeMemoryHandler(
  accessToken: string,
  args: {
    content: string
    contentType?: string
    sourceId?: string
    sourceTable?: string
    metadata?: Record<string, unknown>
    projectId?: string
  },
): Promise<ToolResponse> {
  const { data, error } = await callEdge<{ id: string }>('memory', 'POST', accessToken, {
    content: args.content,
    contentType: args.contentType ?? 'memory',
    ...(args.sourceId !== undefined && { sourceId: args.sourceId }),
    ...(args.sourceTable !== undefined && { sourceTable: args.sourceTable }),
    ...(args.metadata !== undefined &&
      Object.keys(args.metadata).length > 0 && { meta: args.metadata }),
    ...(args.projectId !== undefined && { projectId: args.projectId }),
  })

  if (error) return textResponse(`Failed to store memory: ${error}`)
  if (!data) return textResponse('Failed to store memory: no data returned')
  return textResponse(`Memory stored (ID: ${data.id})`)
}

async function updateMemoryHandler(
  accessToken: string,
  args: {
    id: string
    content?: string
    contentType?: string
    metadata?: Record<string, unknown>
    projectId?: string
  },
): Promise<ToolResponse> {
  const { data, error } = await callEdge<{ id: string }>(
    `memory/${args.id}`,
    'PATCH',
    accessToken,
    {
      ...(args.content !== undefined && { content: args.content }),
      ...(args.contentType !== undefined && { contentType: args.contentType }),
      ...(args.metadata !== undefined &&
        Object.keys(args.metadata).length > 0 && { meta: args.metadata }),
      ...(args.projectId !== undefined && { projectId: args.projectId }),
    },
  )

  if (error) return textResponse(`Failed to update memory: ${error}`)
  if (!data) return textResponse('Failed to update memory: not found')
  return textResponse(`Memory updated (ID: ${data.id})`)
}

async function deleteMemoryHandler(
  accessToken: string,
  supabase: AdminClient,
  userId: string,
  args: {
    id: string
    source: string
  },
): Promise<ToolResponse> {
  if (args.source === 'episodic') {
    // Episodic memories (semantic_memory) — delete via admin client directly
    const { error } = await supabase
      .from('semantic_memory')
      .delete()
      .eq('id', args.id)
      .eq('user_id', userId)
    if (error) return textResponse(`Failed to delete episodic memory: ${error.message}`)
    return textResponse(`Episodic memory deleted (ID: ${args.id})`)
  }

  // Knowledge memories (knowledge_embeddings) — delete via edge function
  const { error } = await callEdge(`memory/${args.id}`, 'DELETE', accessToken)
  if (error) return textResponse(`Failed to delete memory: ${error}`)
  return textResponse(`Memory deleted (ID: ${args.id})`)
}

// ── Episodic memory handler (via memory/context edge function) ─────────────────

async function logContextHandler(
  accessToken: string,
  args: {
    content: string
    memoryType: string
    importance?: number
    expiresInDays?: number
    projectId?: string
  },
): Promise<ToolResponse> {
  const expiresAt =
    args.expiresInDays !== undefined
      ? new Date(Date.now() + args.expiresInDays * MS_PER_DAY).toISOString()
      : undefined

  const { data, error } = await callEdge<{ id: string }>('memory/context', 'POST', accessToken, {
    content: args.content,
    memoryType: args.memoryType,
    ...(args.importance !== undefined && { importance: args.importance }),
    ...(expiresAt !== undefined && { expiresAt }),
    ...(args.projectId !== undefined && { projectId: args.projectId }),
  })

  if (error) return textResponse(`Failed to log context: ${error}`)
  if (!data) return textResponse('Failed to log context: no data returned')
  return textResponse(`Context logged (ID: ${data.id})`)
}

// ── File handler (uses admin client — no edge function for storage) ────────────

async function manageFileHandler(
  supabase: AdminClient,
  args: {
    action: 'upload' | 'download' | 'list' | 'delete'
    path?: string
    content?: string
    contentType?: string
    userId: string
  },
): Promise<ToolResponse> {
  switch (args.action) {
    case 'upload': {
      if (!args.path || !args.content) {
        return textResponse('Error: path and content parameters are both required for upload.')
      }
      const fullPath = `${args.userId}/${args.path}`
      const mimeType = args.contentType ?? 'text/plain'
      const blob = new Blob([args.content], { type: mimeType })
      const { error } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(fullPath, blob, { upsert: true, contentType: mimeType })
      if (error) {
        return textResponse(`Upload failed: ${error.message}`)
      }

      const commitResult = await createFileCommit({
        userId: args.userId,
        message: `Add ${args.path}`,
        files: [
          {
            path: args.path,
            action: 'add',
            ...(args.contentType ? { contentType: args.contentType } : {}),
          },
        ],
      })
      if ('error' in commitResult) {
        console.error('[agent] Failed to record upload commit:', commitResult.error)
      }

      return textResponse(`File uploaded: ${args.path}`)
    }

    case 'download': {
      if (!args.path) {
        return textResponse('Error: path parameter is required for download.')
      }
      const fullPath = `${args.userId}/${args.path}`
      const { data, error } = await supabase.storage.from(FILE_BUCKET).download(fullPath)
      if (error) {
        return textResponse(`Download failed: ${error.message}`)
      }
      const text = await data.text()
      return textResponse(text)
    }

    case 'list': {
      const prefix = args.path ? `${args.userId}/${args.path}` : args.userId
      const { data, error } = await supabase.storage
        .from(FILE_BUCKET)
        .list(prefix, { limit: MAX_FILE_LIST, sortBy: { column: 'name', order: 'asc' } })
      if (error) {
        return textResponse(`List failed: ${error.message}`)
      }
      if (data.length === 0) {
        return textResponse('No files found.')
      }
      const listing = data
        .filter((item) => !item.name.startsWith('.git'))
        .map((item) => {
          const isFile = 'id' in item && typeof (item as { id?: unknown }).id === 'string'
          return isFile ? `  ${item.name}` : `  ${item.name}/`
        })
        .join('\n')
      return textResponse(`Files:\n${listing}`)
    }

    case 'delete': {
      if (!args.path) {
        return textResponse('Error: path parameter is required for delete.')
      }
      const fullPath = `${args.userId}/${args.path}`
      const { error } = await supabase.storage.from(FILE_BUCKET).remove([fullPath])
      if (error) {
        return textResponse(`Delete failed: ${error.message}`)
      }

      const commitResult = await createFileCommit({
        userId: args.userId,
        message: `Delete ${args.path}`,
        files: [{ path: args.path, action: 'delete' }],
      })
      if ('error' in commitResult) {
        console.error('[agent] Failed to record delete commit:', commitResult.error)
      }

      return textResponse(`File deleted: ${args.path}`)
    }
  }
}

// ── Project handlers (direct Supabase — no edge function) ─────────────────────

/** Maximum projects returned by the list action */
const MAX_PROJECT_LIST_SIZE = 20

async function handleListProjects(supabase: AdminClient, userId: string): Promise<ToolResponse> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, workspace_path, slug, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(MAX_PROJECT_LIST_SIZE)

  if (error) return textResponse(`Failed to list projects: ${error.message}`)
  if (data.length === 0) return textResponse('No projects found.')

  const listing = data
    .map((p) => {
      const desc = p.description ? ` — ${p.description}` : ''
      return `- ${p.name}${desc} (path: ${p.workspace_path}, ID: ${p.id})`
    })
    .join('\n')

  return textResponse(`Projects:\n\n${listing}`)
}

async function handleGetProject(
  supabase: AdminClient,
  userId: string,
  id: string | undefined,
): Promise<ToolResponse> {
  if (!id) return textResponse('Error: id parameter is required to get a project.')

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) return textResponse(`Failed to get project: ${error.message}`)

  const desc = data.description ? `\n${data.description}` : ''
  return textResponse(`${data.name}\nPath: ${data.workspace_path}${desc}\n(ID: ${data.id})`)
}

async function handleCreateProject(
  supabase: AdminClient,
  userId: string,
  args: { name?: string; description?: string; workspacePath?: string },
): Promise<ToolResponse> {
  if (!args.name) return textResponse('Error: name parameter is required for project creation.')

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: args.name,
      description: args.description ?? null,
      workspace_path: args.workspacePath ?? `/${args.name.toLowerCase().replace(/\s+/g, '-')}`,
      user_id: userId,
    })
    .select('id, name, description, workspace_path')
    .single()

  if (error) return textResponse(`Failed to create project: ${error.message}`)
  return textResponse(`Project created: "${data.name}" (ID: ${data.id})`)
}

async function handleUpdateProject(
  supabase: AdminClient,
  userId: string,
  args: { id?: string; name?: string; description?: string; workspacePath?: string },
): Promise<ToolResponse> {
  if (!args.id) return textResponse('Error: id parameter is required for update.')

  const body: Record<string, unknown> = {}
  if (args.name !== undefined) body['name'] = args.name
  if (args.description !== undefined) body['description'] = args.description
  if (args.workspacePath !== undefined) body['workspace_path'] = args.workspacePath

  if (Object.keys(body).length === 0) {
    return textResponse(
      'Error: no fields provided to update. Pass at least one of: name, description, workspacePath.',
    )
  }

  const { data, error } = await supabase
    .from('projects')
    .update(body)
    .eq('id', args.id)
    .eq('user_id', userId)
    .select('id, name, description, workspace_path')
    .single()

  if (error) return textResponse(`Failed to update project: ${error.message}`)
  return textResponse(`Project updated: "${data.name}"`)
}

async function handleDeleteProject(
  supabase: AdminClient,
  userId: string,
  id: string | undefined,
): Promise<ToolResponse> {
  if (!id) return textResponse('Error: id parameter is required for deletion.')

  const { error } = await supabase.from('projects').delete().eq('id', id).eq('user_id', userId)

  if (error) return textResponse(`Failed to delete project: ${error.message}`)
  return textResponse('Project deleted.')
}

async function manageProjectHandler(
  supabase: AdminClient,
  userId: string,
  args: {
    action: 'list' | 'get' | 'create' | 'update' | 'delete'
    id?: string
    name?: string
    description?: string
    workspacePath?: string
  },
): Promise<ToolResponse> {
  switch (args.action) {
    case 'list':
      return await handleListProjects(supabase, userId)
    case 'get':
      return await handleGetProject(supabase, userId, args.id)
    case 'create':
      return await handleCreateProject(supabase, userId, args)
    case 'update':
      return await handleUpdateProject(supabase, userId, args)
    case 'delete':
      return await handleDeleteProject(supabase, userId, args.id)
  }
}

// ── Notification handler (via admin client + push-send edge function) ────────

async function sendNotificationHandler(
  supabase: AdminClient,
  userId: string,
  args: {
    title: string
    body?: string
    type?: string
    actionUrl?: string
    sourceId?: string
    sourceType?: string
  },
): Promise<ToolResponse> {
  const notifType = args.type ?? 'reminder'

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      title: args.title,
      body: args.body ?? null,
      type: notifType as 'reminder' | 'task_due' | 'mention' | 'system' | 'achievement',
      action_url: args.actionUrl ?? '/',
      source_id: args.sourceId ?? null,
      source_type: args.sourceType ?? null,
      push_sent: false,
    })
    .select('id')
    .single()

  if (error) return textResponse(`Failed to create notification: ${error.message}`)

  // Trigger push-send to deliver immediately
  try {
    const pushUrl = `${serverEnv.SUPABASE_URL}/functions/v1/push-send`
    const pushRes = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serverEnv.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({ source: 'agent-notification' }),
    })

    if (!pushRes.ok) {
      console.error(`[agent] push-send returned ${String(pushRes.status)}`)
    }
  } catch (pushErr) {
    console.error('[agent] Failed to call push-send:', pushErr)
  }

  return textResponse(`Notification sent: "${args.title}" (ID: ${data.id})`)
}

// ── Reminder handlers (direct Supabase — no edge function) ─────────────────

/** Default snooze duration in minutes */
const DEFAULT_SNOOZE_MINUTES = 15

async function handleCreateReminder(
  supabase: AdminClient,
  userId: string,
  args: {
    title: string
    body?: string
    remindAt: string
    taskId?: string
    noteId?: string
    recurrenceRule?: string
  },
): Promise<ToolResponse> {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      title: args.title,
      body: args.body ?? null,
      remind_at: args.remindAt,
      task_id: args.taskId ?? null,
      note_id: args.noteId ?? null,
      recurrence_rule: args.recurrenceRule ?? null,
      status: 'pending',
    })
    .select('id, title, remind_at')
    .single()

  if (error) return textResponse(`Failed to create reminder: ${error.message}`)
  return textResponse(`Reminder set: "${data.title}" at ${data.remind_at} (ID: ${data.id})`)
}

async function handleListReminders(
  supabase: AdminClient,
  userId: string,
  args: { status?: string },
): Promise<ToolResponse> {
  const statusFilter = args.status ?? 'pending'

  let query = supabase
    .from('reminders')
    .select('id, title, body, remind_at, status, snooze_count, task_id, note_id, recurrence_rule')
    .eq('user_id', userId)
    .order('remind_at', { ascending: true })
    .limit(MAX_REMINDER_LIST_SIZE)

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter as 'pending' | 'sent' | 'dismissed' | 'snoozed')
  }

  const { data, error } = await query

  if (error) return textResponse(`Failed to list reminders: ${error.message}`)
  if (data.length === 0) return textResponse(`No ${statusFilter} reminders found.`)

  const listing = data
    .map((r) => {
      const count = r.snooze_count ?? 0
      const snoozed = count > 0 ? ` (snoozed ${String(count)}x)` : ''
      let linked = ''
      if (r.task_id !== null) linked = ' [task]'
      else if (r.note_id !== null) linked = ' [note]'
      return `- ${r.title} — ${r.remind_at}${snoozed}${linked} (ID: ${r.id})`
    })
    .join('\n')

  return textResponse(`Reminders (${statusFilter}):\n\n${listing}`)
}

async function handleUpdateReminder(
  supabase: AdminClient,
  userId: string,
  args: {
    id: string
    title?: string
    body?: string
    remindAt?: string
    status?: string
    recurrenceRule?: string
  },
): Promise<ToolResponse> {
  const body: Record<string, unknown> = {}
  if (args.title !== undefined) body['title'] = args.title
  if (args.body !== undefined) body['body'] = args.body
  if (args.remindAt !== undefined) body['remind_at'] = args.remindAt
  if (args.status !== undefined) body['status'] = args.status
  if (args.recurrenceRule !== undefined) body['recurrence_rule'] = args.recurrenceRule

  if (Object.keys(body).length === 0) {
    return textResponse(
      'Error: no fields provided to update. Pass at least one of: title, body, remindAt, status, recurrenceRule.',
    )
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(body)
    .eq('id', args.id)
    .eq('user_id', userId)
    .select('id, title, remind_at')
    .single()

  if (error) return textResponse(`Failed to update reminder: ${error.message}`)
  return textResponse(`Reminder updated: "${data.title}"`)
}

async function handleSnoozeReminder(
  supabase: AdminClient,
  userId: string,
  args: { id: string; snoozeMinutes?: number },
): Promise<ToolResponse> {
  // First fetch current snooze_count to increment it
  const { data: current, error: fetchErr } = await supabase
    .from('reminders')
    .select('snooze_count')
    .eq('id', args.id)
    .eq('user_id', userId)
    .single()

  if (fetchErr) return textResponse(`Failed to snooze reminder: ${fetchErr.message}`)

  const snoozeMs = (args.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES) * MS_PER_MINUTE
  const newTime = new Date(Date.now() + snoozeMs).toISOString()
  const newCount = (current.snooze_count ?? 0) + 1

  const { data, error } = await supabase
    .from('reminders')
    .update({
      remind_at: newTime,
      status: 'snoozed',
      snoozed_until: newTime,
      snooze_count: newCount,
    })
    .eq('id', args.id)
    .eq('user_id', userId)
    .select('id, title, remind_at')
    .single()

  if (error) return textResponse(`Failed to snooze reminder: ${error.message}`)
  return textResponse(`Reminder snoozed: "${data.title}" → ${data.remind_at}`)
}

async function handleDismissReminder(
  supabase: AdminClient,
  userId: string,
  args: { id: string },
): Promise<ToolResponse> {
  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'dismissed' })
    .eq('id', args.id)
    .eq('user_id', userId)
    .select('id, title')
    .single()

  if (error) return textResponse(`Failed to dismiss reminder: ${error.message}`)
  return textResponse(`Reminder dismissed: "${data.title}"`)
}

async function handleDeleteReminder(
  supabase: AdminClient,
  userId: string,
  args: { id: string },
): Promise<ToolResponse> {
  const { error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', args.id)
    .eq('user_id', userId)

  if (error) return textResponse(`Failed to delete reminder: ${error.message}`)
  return textResponse('Reminder deleted.')
}

function requireReminderId(id: string | undefined, action: string): ToolResponse | string {
  if (id === undefined) return textResponse(`Error: id is required for ${action} a reminder.`)
  return id
}

function validateReminderCreate(args: {
  title?: string
  remindAt?: string
}): ToolResponse | { title: string; remindAt: string } {
  if (!args.title) return textResponse('Error: title is required for creating a reminder.')
  if (!args.remindAt)
    return textResponse('Error: remindAt (ISO 8601 datetime) is required for creating a reminder.')
  return { title: args.title, remindAt: args.remindAt }
}

/** Build the optional fields object for handleCreateReminder, keeping complexity out of the switch. */
function buildReminderCreateOpts(args: {
  body?: string
  taskId?: string
  noteId?: string
  recurrenceRule?: string
}): { body?: string; taskId?: string; noteId?: string; recurrenceRule?: string } {
  return {
    ...(args.body !== undefined && { body: args.body }),
    ...(args.taskId !== undefined && { taskId: args.taskId }),
    ...(args.noteId !== undefined && { noteId: args.noteId }),
    ...(args.recurrenceRule !== undefined && { recurrenceRule: args.recurrenceRule }),
  }
}

/** Build the optional fields object for handleUpdateReminder. */
function buildReminderUpdateOpts(args: {
  title?: string
  body?: string
  remindAt?: string
  status?: string
  recurrenceRule?: string
}): { title?: string; body?: string; remindAt?: string; status?: string; recurrenceRule?: string } {
  return {
    ...(args.title !== undefined && { title: args.title }),
    ...(args.body !== undefined && { body: args.body }),
    ...(args.remindAt !== undefined && { remindAt: args.remindAt }),
    ...(args.status !== undefined && { status: args.status }),
    ...(args.recurrenceRule !== undefined && { recurrenceRule: args.recurrenceRule }),
  }
}

async function manageReminderHandler(
  supabase: AdminClient,
  userId: string,
  args: {
    action: 'create' | 'list' | 'update' | 'snooze' | 'dismiss' | 'delete'
    id?: string
    title?: string
    body?: string
    remindAt?: string
    status?: string
    snoozeMinutes?: number
    taskId?: string
    noteId?: string
    recurrenceRule?: string
  },
): Promise<ToolResponse> {
  switch (args.action) {
    case 'create': {
      const validated = validateReminderCreate(args)
      if ('content' in validated) return validated
      return await handleCreateReminder(supabase, userId, {
        ...validated,
        ...buildReminderCreateOpts(args),
      })
    }
    case 'list':
      return await handleListReminders(supabase, userId, {
        ...(args.status !== undefined && { status: args.status }),
      })
    case 'update': {
      const id = requireReminderId(args.id, 'updating')
      if (typeof id !== 'string') return id
      return await handleUpdateReminder(supabase, userId, {
        id,
        ...buildReminderUpdateOpts(args),
      })
    }
    case 'snooze': {
      const id = requireReminderId(args.id, 'snoozing')
      if (typeof id !== 'string') return id
      return await handleSnoozeReminder(supabase, userId, {
        id,
        ...(args.snoozeMinutes !== undefined && { snoozeMinutes: args.snoozeMinutes }),
      })
    }
    case 'dismiss': {
      const id = requireReminderId(args.id, 'dismissing')
      if (typeof id !== 'string') return id
      return await handleDismissReminder(supabase, userId, { id })
    }
    case 'delete': {
      const id = requireReminderId(args.id, 'deleting')
      if (typeof id !== 'string') return id
      return await handleDeleteReminder(supabase, userId, { id })
    }
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────
//
// Tool description design (from Anthropic research):
// - Front-load "when to use" — models attend most to the beginning of descriptions
// - Include "when NOT to use" to prevent mis-selection between similar tools
// - Keep parameter docs in zod .describe() — don't repeat in the main description
// - Descriptions should help the model DECIDE and CALL correctly, not document internals

function createSearchKnowledgeTool(accessToken: string) {
  return tool(
    'search_knowledge',
    `Search the user's knowledge base using semantic similarity. Use this tool to find information the user has previously stored — notes, tasks, memories, preferences, and files.

Use when: The user references past context, asks "do I have anything about X?", or when your response would benefit from checking what's already known. This should be your FIRST tool when the query might relate to stored knowledge.
Do NOT use for: Real-time web information (use WebSearch) or reading specific file contents (use manage_file download).

Tip: Specific queries perform better than vague ones — "meeting notes from project alpha" retrieves more useful results than "notes".`,
    {
      query: z.string().describe('Natural language search query — be specific for better results'),
      contentType: z
        .string()
        .optional()
        .describe('Filter by type: memory, fact, preference, context, conversation, file'),
      limit: z
        .number()
        .min(1)
        .max(MAX_SEARCH_RESULTS)
        .default(DEFAULT_SEARCH_LIMIT)
        .describe('Max results (1–50, default 10)'),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_SIMILARITY_THRESHOLD)
        .describe('Similarity cutoff (0–1, default 0.5). Raise to 0.7+ for precise matches'),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe('Filter results to a specific project. Use manage_project to list projects.'),
    },
    async (args) => {
      const { contentType, projectId, ...rest } = args
      return await searchKnowledgeHandler(accessToken, {
        ...rest,
        ...(contentType !== undefined && { contentType }),
        ...(projectId !== undefined && { projectId }),
      })
    },
  )
}

function createStoreMemoryTool(accessToken: string) {
  return tool(
    'store_memory',
    `Store a new fact in the user's long-term knowledge base with semantic embedding for future retrieval.

Use when: The user asks you to remember something, you learn a stable fact about them, or you want to persist a preference or correction.
Do NOT use for: Updating existing memories (use update_memory), deleting memories (use delete_memory), temporary context (use log_context), or full documents (use manage_file).

Write in third person: "User prefers dark mode" not "You prefer dark mode". One fact per memory — do not bundle unrelated information. Search first to avoid duplicates.`,
    {
      content: z.string().describe('The fact to store — third person, with sufficient context'),
      contentType: z
        .string()
        .default('memory')
        .describe('Category: memory, fact, preference, context'),
      sourceId: z
        .string()
        .uuid()
        .optional()
        .describe('UUID reference to a source record (e.g., task or note ID)'),
      sourceTable: z.string().optional().describe('Source table name if linking to another record'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Additional key-value metadata'),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe('Associate memory with a project for scoped retrieval'),
    },
    async (args) => {
      const { sourceId, sourceTable, metadata, projectId, ...rest } = args
      return await storeMemoryHandler(accessToken, {
        ...rest,
        ...(sourceId !== undefined && { sourceId }),
        ...(sourceTable !== undefined && { sourceTable }),
        ...(metadata !== undefined && { metadata }),
        ...(projectId !== undefined && { projectId }),
      })
    },
  )
}

function createUpdateMemoryTool(accessToken: string) {
  return tool(
    'update_memory',
    `Update an existing memory's content, type, or metadata. The content is re-embedded automatically.

Use when: A memory found via search_knowledge is outdated or needs correction but the core fact is still relevant.
Do NOT use for: Creating new memories (use store_memory) or removing memories entirely (use delete_memory).

Get the memory ID from search_knowledge results.`,
    {
      id: z.string().uuid().describe('Memory ID from search_knowledge results'),
      content: z.string().optional().describe('Updated content — re-embedded automatically'),
      contentType: z
        .string()
        .optional()
        .describe('Updated category: memory, fact, preference, context'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Updated key-value metadata'),
      projectId: z.string().uuid().optional().describe('Associate memory with a project'),
    },
    async (args) => {
      return await updateMemoryHandler(accessToken, {
        id: args.id,
        ...(args.content !== undefined && { content: args.content }),
        ...(args.contentType !== undefined && { contentType: args.contentType }),
        ...(args.metadata !== undefined && { metadata: args.metadata }),
        ...(args.projectId !== undefined && { projectId: args.projectId }),
      })
    },
  )
}

function createDeleteMemoryTool(accessToken: string, supabase: AdminClient, userId: string) {
  return tool(
    'delete_memory',
    `Permanently delete a memory from the user's knowledge base.

Use when: A memory is stale, incorrect, duplicated, or the user asks you to forget something.
Do NOT use for: Updating memories (use update_memory) — only delete when the information is no longer valid at all.

Get the memory ID and source ("knowledge" or "episodic") from search_knowledge results. The source determines which table to delete from.`,
    {
      id: z.string().uuid().describe('Memory ID from search_knowledge results'),
      source: z
        .enum(['knowledge', 'episodic'])
        .describe('Memory source table from search_knowledge results'),
    },
    async (args) => {
      return await deleteMemoryHandler(accessToken, supabase, userId, args)
    },
  )
}

function createLogContextTool(accessToken: string) {
  return tool(
    'log_context',
    `Log episodic context — conversation takeaways, session decisions, meeting summaries, and time-sensitive situational awareness that may be relevant in upcoming conversations.

Use when: After meaningful conversations (summarise decisions and action items), when the user shares active project state or time-sensitive information, or to record session observations like "User is preparing for a board meeting next week".
Do NOT use for: Stable permanent facts about the user (use store_memory instead) — e.g., name, role, timezone, enduring preferences.

Write in third person: "User discussed moving plans with Jamie" not "You discussed…". Be specific.`,
    {
      content: z.string().describe('Episodic context — third person, with specifics'),
      memoryType: z
        .enum(['fact', 'conversation', 'task', 'project', 'preference'])
        .describe('Category of context'),
      importance: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_IMPORTANCE)
        .describe('0.3 = minor, 0.5 = standard, 0.7 = important, 0.9 = critical'),
      expiresInDays: z
        .number()
        .positive()
        .optional()
        .describe('Auto-expire after N days. Omit for no expiry. 7 = weekly, 30 = monthly'),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe('Associate context with a project for scoped retrieval'),
    },
    async (args) => {
      const { expiresInDays, projectId, ...rest } = args
      return await logContextHandler(accessToken, {
        ...rest,
        ...(expiresInDays !== undefined && { expiresInDays }),
        ...(projectId !== undefined && { projectId }),
      })
    },
  )
}

function createManageFileTool(supabase: AdminClient, userId: string) {
  return tool(
    'manage_file',
    `Upload, download, list, or delete files in the user's persistent cloud storage.

This is the ONLY way to create, read, or manage files — there is no local filesystem.

Use when: Generating documents or code for the user, reading uploaded files, browsing the file directory, or deleting files.
Do NOT use for: Structured data storage (use store_memory).

Actions: "upload" (requires path + content, upserts if file exists), "download" (requires path, returns content as text), "list" (optional path prefix), "delete" (requires path).

Paths are relative to the user's root — do NOT include user ID prefix.`,
    {
      action: z.enum(['upload', 'download', 'list', 'delete']).describe('File action'),
      path: z
        .string()
        .optional()
        .describe('File path relative to user root, e.g., "documents/report.md"'),
      content: z.string().optional().describe('File content as text — required for upload'),
      contentType: z
        .string()
        .optional()
        .describe('MIME type, e.g., "text/markdown" (defaults to text/plain)'),
    },
    async (args) => {
      const { path, content, contentType, ...rest } = args
      return await manageFileHandler(supabase, {
        ...rest,
        ...(path !== undefined && { path }),
        ...(content !== undefined && { content }),
        ...(contentType !== undefined && { contentType }),
        userId,
      })
    },
  )
}

function createManageProjectTool(supabase: AdminClient, userId: string) {
  return tool(
    'manage_project',
    `Create, list, get, update, or delete projects for organising conversations, tasks, notes, and memories into logical groups.

Use when: The user mentions a project, wants to group related work, or you need to associate tasks/notes with a specific initiative.
Do NOT use for: Individual memory or file management (use store_memory / manage_file with project_id parameter instead).

Actions: "create" (requires name), "get" (requires id), "update" (requires id + fields), "delete" (requires id), "list" (shows all projects).

After creating a project, use its ID as the projectId parameter when storing memories or managing files to associate them.`,
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('Project action'),
      id: z.string().uuid().optional().describe('Project ID — required for get, update, delete'),
      name: z.string().optional().describe('Project name — required for create'),
      description: z.string().optional().describe('Project description'),
      workspacePath: z
        .string()
        .optional()
        .describe('Logical grouping path, e.g., "/work/client-a"'),
    },
    async (args) => {
      const { id, name, description, workspacePath, ...rest } = args
      return await manageProjectHandler(supabase, userId, {
        ...rest,
        ...(id !== undefined && { id }),
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(workspacePath !== undefined && { workspacePath }),
      })
    },
  )
}

function createSendNotificationTool(supabase: AdminClient, userId: string) {
  return tool(
    'send_notification',
    `Send a push notification to the user's devices with a custom title and body.

Use when: The user asks to be reminded about something, you want to alert them about a time-sensitive event, or you've completed a long-running task and want to notify them.
Do NOT use for: Conversational responses — just reply normally.

The notification is delivered immediately via Web Push to all subscribed devices. The user must have push notifications enabled in settings and at least one device subscribed.`,
    {
      title: z.string().describe('Notification title — short, clear, and actionable'),
      body: z.string().optional().describe('Notification body — additional context or details'),
      type: z
        .enum(['reminder', 'task_due', 'mention', 'system', 'achievement'])
        .default('reminder')
        .describe('Notification category'),
      actionUrl: z
        .string()
        .optional()
        .describe('URL to navigate to when tapped (e.g., "/tasks", "/notes")'),
      sourceId: z.string().uuid().optional().describe('ID of related resource (task, note, etc.)'),
      sourceType: z.string().optional().describe('Type of related resource (e.g., "task", "note")'),
    },
    async (args) => {
      const { actionUrl, sourceId, sourceType, body, ...rest } = args
      return await sendNotificationHandler(supabase, userId, {
        ...rest,
        ...(body !== undefined && { body }),
        ...(actionUrl !== undefined && { actionUrl }),
        ...(sourceId !== undefined && { sourceId }),
        ...(sourceType !== undefined && { sourceType }),
      })
    },
  )
}

function createManageReminderTool(supabase: AdminClient, userId: string) {
  return tool(
    'manage_reminder',
    `Create, list, update, snooze, dismiss, or delete reminders. Reminders trigger push notifications at the specified time.

Use when: The user asks to be reminded about something at a specific time, wants to see upcoming reminders, or needs to reschedule/dismiss one. Always confirm the exact time in the user's timezone before creating.
Do NOT use for: Immediate notifications (use send_notification) or task due dates (set dueDate + dueTime on the task instead).

Actions: "create" (requires title + remindAt), "list" (optional status filter), "update" (requires id + fields), "snooze" (requires id, defaults to 15 min), "dismiss" (requires id), "delete" (requires id).

Snooze patterns: If a user repeatedly snoozes the same reminder (snooze_count visible in list results), gently note it — this may indicate avoidance or poor timing.`,
    {
      action: z
        .enum(['create', 'list', 'update', 'snooze', 'dismiss', 'delete'])
        .describe('Reminder action'),
      id: z
        .string()
        .uuid()
        .optional()
        .describe('Reminder ID — required for update, snooze, dismiss, delete'),
      title: z.string().optional().describe('Reminder title — required for create'),
      body: z.string().optional().describe('Additional context for the reminder'),
      remindAt: z
        .string()
        .optional()
        .describe(
          'ISO 8601 datetime for the reminder (e.g., "2026-03-10T14:30:00Z"). Required for create. Use the user\'s timezone.',
        ),
      status: z
        .string()
        .optional()
        .describe('For list: "pending" (default), "snoozed", "sent", "dismissed", or "all"'),
      snoozeMinutes: z
        .number()
        .positive()
        .optional()
        .describe('Minutes to snooze (default 15). Common values: 5, 15, 30, 60'),
      taskId: z.string().uuid().optional().describe('Link reminder to a task'),
      noteId: z.string().uuid().optional().describe('Link reminder to a note'),
      recurrenceRule: z
        .string()
        .optional()
        .describe('iCal RRULE for recurring reminders (e.g., "FREQ=DAILY;INTERVAL=1")'),
    },
    async (args) => {
      const {
        id,
        title,
        body: reminderBody,
        remindAt,
        status,
        snoozeMinutes,
        taskId,
        noteId,
        recurrenceRule,
        ...rest
      } = args
      return await manageReminderHandler(supabase, userId, {
        ...rest,
        ...(id !== undefined && { id }),
        ...(title !== undefined && { title }),
        ...(reminderBody !== undefined && { body: reminderBody }),
        ...(remindAt !== undefined && { remindAt }),
        ...(status !== undefined && { status }),
        ...(snoozeMinutes !== undefined && { snoozeMinutes }),
        ...(taskId !== undefined && { taskId }),
        ...(noteId !== undefined && { noteId }),
        ...(recurrenceRule !== undefined && { recurrenceRule }),
      })
    },
  )
}

// ── MCP Server factory ────────────────────────────────────────────────────────

export function createIrisToolsServer(
  userId: string,
  accessToken: string,
  adminClient?: AdminClient,
): ReturnType<typeof createSdkMcpServer> {
  const supabase = adminClient ?? createAgentAdminClient()

  return createSdkMcpServer({
    name: 'iris-tools',
    version: '1.0.0',
    tools: [
      createSearchKnowledgeTool(accessToken),
      createStoreMemoryTool(accessToken),
      createUpdateMemoryTool(accessToken),
      createDeleteMemoryTool(accessToken, supabase, userId),
      createLogContextTool(accessToken),
      createManageFileTool(supabase, userId),
      createManageProjectTool(supabase, userId),
      createManageReminderTool(supabase, userId),
      createSendNotificationTool(supabase, userId),
    ],
  })
}
