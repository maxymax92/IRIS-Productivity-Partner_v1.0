'use client'

import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { IrisMemory } from '@/components/iris-memory'
import { IrisPreferences } from '@/components/iris-preferences'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useConversations } from '@/hooks/use-conversations'
import { useTimezoneSync } from '@/hooks/use-timezone-sync'
import { UserSettingsProvider } from '@/hooks/use-user-settings'
import { signOut } from '@/lib/auth/actions'

function CanvasDialogs({
  isHelpOpen,
  isMemoryOpen,
  isSettingsOpen,
  setIsHelpOpen,
  setIsMemoryOpen,
  setIsSettingsOpen,
}: {
  isHelpOpen: boolean
  isMemoryOpen: boolean
  isSettingsOpen: boolean
  setIsHelpOpen: (v: boolean) => void
  setIsMemoryOpen: (v: boolean) => void
  setIsSettingsOpen: (v: boolean) => void
}) {
  const { isMobile } = useSidebar()

  return (
    <>
      {/* Preferences — Sheet on mobile, Dialog on desktop */}
      {isMobile ? (
        <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <SheetContent side='bottom' className='max-h-(--max-height-settings) overflow-auto p-0'>
            <SheetHeader className='sr-only'>
              <SheetTitle>Preferences</SheetTitle>
              <SheetDescription>Model, AI, integrations, and region.</SheetDescription>
            </SheetHeader>
            <IrisPreferences />
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogHeader className='sr-only'>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription>Model, AI, integrations, and region.</DialogDescription>
          </DialogHeader>
          <DialogContent className='max-w-md overflow-auto p-0'>
            <IrisPreferences />
          </DialogContent>
        </Dialog>
      )}

      {/* Memory — Sheet on mobile, Dialog on desktop */}
      {isMobile ? (
        <Sheet open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
          <SheetContent side='bottom' className='max-h-(--max-height-settings) overflow-auto p-0'>
            <SheetHeader className='sr-only'>
              <SheetTitle>Memory</SheetTitle>
              <SheetDescription>What Iris remembers, export, and data controls.</SheetDescription>
            </SheetHeader>
            <IrisMemory />
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
          <DialogHeader className='sr-only'>
            <DialogTitle>Memory</DialogTitle>
            <DialogDescription>What Iris remembers, export, and data controls.</DialogDescription>
          </DialogHeader>
          <DialogContent className='max-w-md overflow-auto p-0'>
            <IrisMemory />
          </DialogContent>
        </Dialog>
      )}

      {/* Help — always Dialog (not commonly used on mobile) */}
      <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
        <DialogHeader className='sr-only'>
          <DialogTitle>Help &amp; Guidance</DialogTitle>
          <DialogDescription>Shortcuts and getting started.</DialogDescription>
        </DialogHeader>
        <DialogContent className='max-w-lg'>
          <div className='space-y-4 text-sm'>
            <h3 className='text-foreground font-medium'>Keyboard shortcuts</h3>
            <ul className='text-muted-foreground space-y-2'>
              <li>
                <Kbd className='inline'>⌘</Kbd> <Kbd className='inline'>,</Kbd> — Settings
              </li>
              <li>
                <Kbd className='inline'>⌘</Kbd> <Kbd className='inline'>/</Kbd> — Keyboard shortcuts
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CanvasSidebarTrigger() {
  const { state, isMobile } = useSidebar()
  if (!isMobile && state === 'expanded') return null
  return (
    <SidebarTrigger className='pointer-events-auto transition-transform hover:scale-110 active:scale-90' />
  )
}

export function Canvas({ user }: { user: User | null }) {
  return (
    <UserSettingsProvider>
      <CanvasInner user={user} />
    </UserSettingsProvider>
  )
}

function CanvasInner({ user }: { user: User | null }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isMemoryOpen, setIsMemoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  useTimezoneSync()

  const handleSignOut = useCallback(() => {
    void signOut()
  }, [])
  const handleOpenMemory = useCallback(() => setIsMemoryOpen(true), [])
  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), [])
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    loadMessages,
  } = useConversations()
  const handleNewChat = useCallback(() => {
    setActiveConversationId(null)
  }, [setActiveConversationId])
  const handleDeleteConversation = useCallback(
    (id: string) => {
      void deleteConversation(id)
    },
    [deleteConversation],
  )
  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
    },
    [setActiveConversationId],
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setIsHelpOpen(true)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className='flex min-h-screen w-full min-w-0'>
          <AppSidebar
            activeConversationId={activeConversationId}
            conversations={conversations}
            user={user}
            onNewChat={handleNewChat}
            onDeleteConversation={handleDeleteConversation}
            onOpenMemory={handleOpenMemory}
            onOpenSettings={handleOpenSettings}
            onSelectConversation={handleSelectConversation}
            onSignOut={handleSignOut}
          />
          <SidebarInset>
            <div className='bg-background relative min-h-screen min-w-0'>
              <div
                className='pointer-events-none fixed right-0 left-0 z-20 flex items-start justify-center px-4'
                style={{ top: 'max(var(--spacing-canvas-inset), env(safe-area-inset-top, 0px))' }}
              >
                <div className='absolute top-1 left-4'>
                  <CanvasSidebarTrigger />
                </div>
              </div>

              <div
                className='pt-20'
                style={{ paddingTop: 'max(5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))' }}
              >
                <div className='min-h-canvas'>
                  <ChatView
                    activeConversationId={activeConversationId}
                    createConversation={createConversation}
                    loadMessages={loadMessages}
                    user={user}
                  />
                </div>
              </div>
              <CanvasDialogs
                isHelpOpen={isHelpOpen}
                isMemoryOpen={isMemoryOpen}
                isSettingsOpen={isSettingsOpen}
                setIsHelpOpen={setIsHelpOpen}
                setIsMemoryOpen={setIsMemoryOpen}
                setIsSettingsOpen={setIsSettingsOpen}
              />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
