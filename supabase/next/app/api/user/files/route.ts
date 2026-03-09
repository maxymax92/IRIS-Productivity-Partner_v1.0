import { NextResponse } from 'next/server'

import { FILE_LIST_LIMIT, SIGNED_URL_EXPIRY_SECONDS, STORAGE_BUCKET } from '@/lib/constants'
import { createFileCommit } from '@/lib/files/commits'
import { createClient } from '@/lib/supabase/server'
import type { FileTreeNode } from '@/types/files'

export type { FileTreeNode } from '@/types/files'

const BUCKET = STORAGE_BUCKET

function assertUserPath(path: string, userId: string): string | null {
  const trimmed = path.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '')
  if (!trimmed) return null
  return `${userId}/${trimmed}`
}

async function collectPathsUnderPrefix(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = []
  const { data } = await supabase.storage.from(bucket).list(prefix.replace(/\/$/, ''), {
    limit: FILE_LIST_LIMIT,
    sortBy: { column: 'name', order: 'asc' },
  })
  for (const item of data ?? []) {
    const fullPath = prefix.endsWith('/') ? `${prefix}${item.name}` : `${prefix}/${item.name}`
    const hasId = 'id' in item && typeof (item as { id?: unknown }).id === 'string'
    if (hasId) {
      paths.push(fullPath)
    } else {
      paths.push(...(await collectPathsUnderPrefix(supabase, bucket, `${fullPath}/`)))
    }
  }
  return paths
}

function buildTreeFromPaths(prefix: string, paths: string[]): FileTreeNode[] {
  const childrenByPath = new Map<string, Set<string>>()
  const filePaths = new Set<string>()

  for (const fullPath of paths) {
    const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath
    const trimmed = rel.replace(/^\/+|\/+$/g, '')
    if (!trimmed) continue
    const parts = trimmed.split('/')

    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      const currentPath = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1 && !fullPath.endsWith('/')) {
        filePaths.add(currentPath)
      }
      const set = childrenByPath.get(parent) ?? new Set<string>()
      set.add(currentPath)
      childrenByPath.set(parent, set)
    }
  }

  function node(path: string): FileTreeNode | null {
    const name = path.split('/').pop() ?? path
    const children = childrenByPath.get(path)
    const isFile = filePaths.has(path)
    if (isFile) return { type: 'file', name, path }
    if (!children || children.size === 0) return null
    const childNodes = [...children]
      .map((p) => node(p))
      .filter((n): n is FileTreeNode => n !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (childNodes.length === 0) return null
    return { type: 'folder', name, path, children: childNodes }
  }

  const rootChildren = childrenByPath.get('') ?? new Set()
  return [...rootChildren]
    .map((p) => node(p))
    .filter((n): n is FileTreeNode => n !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Signed URL for file download/preview
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'signed-url') {
    const path = searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
    const fullPath = assertUserPath(path, user.id)
    if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

    const { data, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fullPath, SIGNED_URL_EXPIRY_SECONDS)
    if (signError) return NextResponse.json({ error: signError.message }, { status: 500 })
    return NextResponse.json({ url: data.signedUrl })
  }

  // Default: list file tree
  const prefix = `${user.id}/`
  const { data: objects, error } = await supabase.storage
    .from(BUCKET)
    .list(user.id, { limit: FILE_LIST_LIMIT, sortBy: { column: 'name', order: 'asc' } })

  if (error) {
    if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
      return NextResponse.json({ tree: [] })
    }
    return NextResponse.json({ error: error.message, tree: [] })
  }

  const files: string[] = []
  const folderPromises: Promise<string[]>[] = []
  for (const item of objects ?? []) {
    if (item.name.startsWith('.git')) continue
    const fullPath = `${user.id}/${item.name}`
    const hasId = 'id' in item && (item as { id?: unknown }).id
    if (hasId) {
      files.push(fullPath)
    } else {
      folderPromises.push(collectPathsUnderPrefix(supabase, BUCKET, `${user.id}/${item.name}/`))
    }
  }
  const folderResults = await Promise.all(folderPromises)
  const paths = [...files, ...folderResults.flat()]

  const tree = buildTreeFromPaths(prefix, paths)
  return NextResponse.json({ tree })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') ?? ''
  const isFormData = contentType.includes('multipart/form-data')

  if (isFormData) {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const pathParam = formData.get('path') as string | null
    if (!file || !pathParam) {
      return NextResponse.json({ error: 'Missing file or path' }, { status: 400 })
    }
    const fullPath = assertUserPath(pathParam, user.id)
    if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

    const { error } = await supabase.storage.from(BUCKET).upload(fullPath, file, { upsert: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const commitResult = await createFileCommit({
      userId: user.id,
      message: `Add ${pathParam}`,
      files: [{ path: pathParam, action: 'add', size: file.size, contentType: file.type }],
    })
    if ('error' in commitResult) {
      console.error('[files] Failed to record upload commit:', commitResult.error)
    }

    return NextResponse.json({ ok: true })
  }

  const body = (await request.json().catch(() => null)) as {
    path?: string
    folder?: boolean
  } | null
  const pathParam = body?.path
  const isFolder = body?.folder === true
  if (!pathParam || !isFolder) {
    return NextResponse.json(
      { error: 'For folder creation, send { path, folder: true }' },
      { status: 400 },
    )
  }
  const fullPath = assertUserPath(pathParam, user.id)
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  const folderPath = `${fullPath}/.keep`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(folderPath, new Blob([]), { upsert: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const pathParam = searchParams.get('path')
  if (!pathParam) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const fullPath = assertUserPath(pathParam, user.id)
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  const underFolder = await collectPathsUnderPrefix(supabase, BUCKET, `${fullPath}/`)
  const toRemove = underFolder.length > 0 ? underFolder : [fullPath]
  const { error } = await supabase.storage.from(BUCKET).remove(toRemove)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Record delete commits for each removed file (strip userId prefix from paths)
  const prefix = `${user.id}/`
  const deletedFiles = toRemove.map((p) => ({
    path: p.startsWith(prefix) ? p.slice(prefix.length) : p,
    action: 'delete' as const,
  }))
  const commitResult = await createFileCommit({
    userId: user.id,
    message: `Delete ${pathParam}`,
    files: deletedFiles,
  })
  if ('error' in commitResult) {
    console.error('[files] Failed to record delete commit:', commitResult.error)
  }

  return NextResponse.json({ ok: true })
}
