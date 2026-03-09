'use client'

import type { User } from '@supabase/supabase-js'
import { parseISO, startOfDay, startOfYesterday } from 'date-fns'
import {
  Brain,
  ChevronDown,
  Download,
  File,
  LogOut,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { type FileTreeNode, useProjectFiles } from '@/hooks/use-project-files'
import { cn } from '@/lib/utils'
import type { Tables } from '@/types/database.types'

type Conversation = Tables<'conversations'>

// ── Helpers ──────────────────────────────────────────────────────────

function groupByDate<T extends { updated_at: string }>(items: T[]) {
  const todayStart = startOfDay(new Date())
  const yesterdayStart = startOfYesterday()

  const today: T[] = []
  const yesterday: T[] = []
  const older: T[] = []
  for (const item of items) {
    const d = parseISO(item.updated_at)
    if (d >= todayStart) today.push(item)
    else if (d >= yesterdayStart) yesterday.push(item)
    else older.push(item)
  }
  return { today, yesterday, older }
}

/** Recursively flatten a file tree into a flat list of files (no folders). */
function flattenTree(nodes: FileTreeNode[]): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ name: node.name, path: node.path })
    } else {
      result.push(...flattenTree(node.children))
    }
  }
  return result
}

// ── Chat conversations list ──────────────────────────────────────────

function ConversationsList({
  activeId,
  conversations,
  onSelect,
  onDelete,
}: {
  activeId: string | null
  conversations: Conversation[]
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const grouped = useMemo(() => groupByDate(conversations), [conversations])

  const renderGroup = (label: string, items: Conversation[]) => {
    if (items.length === 0) return null
    return (
      <SidebarGroup key={label}>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarMenu>
          {items.map((c) => (
            <SidebarMenuItem key={c.id}>
              <SidebarMenuButton
                isActive={activeId === c.id}
                onClick={() => onSelect(c.id)}
                tooltip={c.title ?? c.summary ?? 'New conversation'}
              >
                <span>{c.title ?? c.summary ?? 'New conversation'}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                showOnHover
                className='transition-transform active:scale-75 [&>svg]:size-3'
                onClick={() => onDelete(c.id)}
              >
                <Trash2 />
                <span className='sr-only'>Delete</span>
              </SidebarMenuAction>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    )
  }

  return (
    <>
      {renderGroup('Today', grouped.today)}
      {renderGroup('Yesterday', grouped.yesterday)}
      {renderGroup('Older', grouped.older)}
      {conversations.length === 0 && (
        <div className='text-muted-foreground px-2 py-4 text-center text-sm'>
          No conversations yet
        </div>
      )}
    </>
  )
}

// ── Artifacts (flat file list) ────────────────────────────────────────

function ArtifactsList() {
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    tree,
    loading: isLoading,
    error,
    refresh,
    uploadFile,
    deletePath,
    getSignedUrl,
  } = useProjectFiles()
  const files = useMemo(() => flattenTree(tree), [tree])

  const handleUpload = () => {
    fileInputRef.current?.click()
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const input = e.target
    void uploadFile(file.name, file).then((err) => {
      input.value = ''
      if (err) toast.error(err)
    })
  }

  const handleOpen = (path: string) => {
    void getSignedUrl(path).then((url) => {
      if (url) {
        window.open(url, '_blank', 'noopener')
      } else {
        toast.error('Failed to get download URL')
      }
    })
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    void deletePath(deleteTarget).then((err) => {
      setIsDeleting(false)
      setDeleteTarget(null)
      if (err) toast.error(err)
    })
  }

  return (
    <>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={isDeleting}
              onClick={handleDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <SidebarGroup>
          <SidebarGroupLabel className='pr-1'>
            <CollapsibleTrigger className='flex flex-1 items-center gap-2'>
              <Paperclip className='size-4' />
              Artifacts
              {files.length > 0 && (
                <span className='text-muted-foreground ml-auto tabular-nums'>{files.length}</span>
              )}
              <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
            </CollapsibleTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button
                  type='button'
                  className='text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground touch:size-9 flex size-6 items-center justify-center rounded-md p-0.5 transition-transform'
                >
                  <Plus className='size-4' />
                  <span className='sr-only'>File actions</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' side='right'>
                <DropdownMenuItem onSelect={handleUpload}>
                  <Upload />
                  Upload File
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={refresh}>
                  <RefreshCw />
                  Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupLabel>

          <input
            accept='*'
            className='hidden'
            onChange={onFileChange}
            ref={fileInputRef}
            type='file'
          />

          <CollapsibleContent>
            {isLoading ? (
              <div className='text-muted-foreground px-2 py-3 text-sm'>Loading...</div>
            ) : null}
            {!isLoading && error ? (
              <div className='text-destructive px-2 py-3 text-sm'>{error}</div>
            ) : null}
            {!isLoading && !error && files.length === 0 ? (
              <div className='text-muted-foreground px-2 py-3 text-sm'>
                No files yet. Upload a file to get started.
              </div>
            ) : null}
            {!isLoading && !error && files.length > 0 ? (
              <SidebarMenu className={isDeleting ? 'pointer-events-none opacity-60' : undefined}>
                {files.map((f) => (
                  <SidebarMenuItem key={f.path}>
                    <SidebarMenuButton onClick={() => handleOpen(f.path)} tooltip={f.path}>
                      <File />
                      <span>{f.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      className='transition-transform active:scale-75 [&>svg]:size-3'
                      onClick={() => setDeleteTarget(f.path)}
                    >
                      <Trash2 />
                      <span className='sr-only'>Delete</span>
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : null}
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    </>
  )
}

// ── Main sidebar ─────────────────────────────────────────────────────

export interface AppSidebarProps {
  activeConversationId: string | null
  conversations: Conversation[]
  user: User | null
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  onOpenMemory: () => void
  onOpenSettings: () => void
  onSelectConversation: (id: string) => void
  onSignOut: () => void
}

function getUserName(user: User | null): string {
  if (!user) return ''
  const meta = user.user_metadata as Record<string, unknown> | undefined
  return (
    (meta?.['full_name'] as string | undefined) ??
    (meta?.['name'] as string | undefined) ??
    user.email ??
    ''
  )
}

function getUserInitials(user: User | null): string {
  const name = getUserName(user)
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
  return (name[0] ?? '?').toUpperCase()
}

function getUserDisplayName(user: User | null): string {
  const name = getUserName(user)
  if (!name) return 'Account'
  if (name.includes('@')) return name.split('@')[0] ?? 'Account'
  return name
}

export function AppSidebar({
  activeConversationId,
  conversations,
  user,
  onNewChat,
  onDeleteConversation,
  onOpenMemory,
  onOpenSettings,
  onSelectConversation,
  onSignOut,
}: AppSidebarProps) {
  const initials = getUserInitials(user)
  const { canInstall, promptInstall } = useInstallPrompt()

  return (
    <Sidebar
      variant='floating'
      className='[&_[data-slot=sidebar-inner]]:shadow-card [&_[data-slot=sidebar-inner]]:rounded-2xl'
    >
      {/* Header: toggle + IRIS branding + plus button */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className='flex h-12 items-center gap-2 px-2'>
              <SidebarTrigger className='transition-transform hover:scale-110 active:scale-90' />
              <span className='tracking-display text-accent-strong text-lg font-medium'>
                I R I S
              </span>
            </div>
            <SidebarMenuAction
              onClick={onNewChat}
              className='top-3 transition-transform hover:scale-110 active:scale-90'
            >
              <Plus />
              <span className='sr-only'>New chat</span>
            </SidebarMenuAction>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Artifacts (flat file list) */}
        <ArtifactsList />

        {/* Conversations */}
        <ConversationsList
          activeId={activeConversationId}
          conversations={conversations}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
        />
      </SidebarContent>

      {/* Footer: user avatar + menu */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size='lg' className='transition-transform active:scale-95'>
                  <Avatar className='ring-sidebar-border size-8 rounded-lg ring-1'>
                    <AvatarFallback className='bg-accent-muted text-accent-strong rounded-lg text-sm font-medium'>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className='grid flex-1 text-left leading-tight'>
                    <span className='truncate text-sm font-medium'>{getUserDisplayName(user)}</span>
                    <span className='text-muted-foreground truncate text-xs'>
                      {user?.email ?? ''}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' side='top' className='w-48'>
                <DropdownMenuItem onSelect={onOpenSettings}>
                  <UserIcon />
                  Preferences
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenMemory}>
                  <Brain />
                  Memory
                </DropdownMenuItem>
                {canInstall ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        void promptInstall()
                      }}
                    >
                      <Download />
                      Install App
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className='text-destructive focus:text-destructive focus:bg-destructive/10'
                  onSelect={onSignOut}
                >
                  <LogOut />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
