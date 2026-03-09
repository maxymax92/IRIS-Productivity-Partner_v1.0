import { ArrowUp, MessageCircle, Paperclip, Plus } from 'lucide-react'

function MockSidebar() {
  return (
    <div className='hidden w-55 p-4 md:block'>
      <div className='glass-panel backdrop-blur-panel backdrop-saturate-glass flex h-full flex-col rounded-3xl p-4'>
        <p className='text-muted-foreground mb-3 text-sm font-medium tracking-widest'>I R I S</p>

        <div className='mb-3 flex justify-center'>
          <Plus className='text-muted-foreground h-4 w-4' />
        </div>

        <div className='flex-1 space-y-0.5'>
          <p className='text-muted-foreground/60 mb-1.5 text-xs font-semibold tracking-wide uppercase'>
            Today
          </p>
          <div className='bg-border/20 rounded-lg px-3 py-2'>
            <p className='text-foreground/70 text-xs'>Redesigning the dashboard</p>
          </div>
          <div className='px-3 py-2'>
            <p className='text-muted-foreground/60 text-xs'>Fix auth middleware bug</p>
          </div>
          <div className='px-3 py-2'>
            <p className='text-muted-foreground/60 text-xs'>Deploy to Railway</p>
          </div>

          <p className='text-muted-foreground/60 mt-3 mb-1.5 text-xs font-semibold tracking-wide uppercase'>
            Yesterday
          </p>
          <div className='px-3 py-2'>
            <p className='text-muted-foreground/60 text-xs'>API refactor planning</p>
          </div>
          <div className='px-3 py-2'>
            <p className='text-muted-foreground/60 text-xs'>Memory browser design</p>
          </div>
        </div>

        <div className='border-border/20 mt-auto flex justify-center border-t pt-3'>
          <div className='bg-primary text-accent flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium'>
            MX
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductTeaser() {
  return (
    <div className='relative mx-auto h-[26.25rem] max-w-[96rem] px-4 sm:px-6'>
      {/* Ambient wash — gives backdrop-blur something to diffuse */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 30% 40%, oklch(from var(--accent) l c h / 8%) 0%, transparent 70%), radial-gradient(ellipse 50% 50% at 70% 50%, oklch(from var(--muted-foreground) l c h / 6%) 0%, transparent 70%)',
        }}
      />
      <div
        className='glass-panel backdrop-blur-panel backdrop-saturate-glass relative overflow-hidden rounded-t-2xl shadow-lg'
        style={{ borderBottom: 'none' }}
      >
        {/* Window chrome */}
        <div className='border-border/15 flex items-center gap-2 border-b px-5 py-3'>
          <span className='bg-border h-2.5 w-2.5 rounded-full' />
          <span className='bg-border h-2.5 w-2.5 rounded-full' />
          <span className='bg-border h-2.5 w-2.5 rounded-full' />
        </div>

        {/* App layout */}
        <div className='flex min-h-[26.25rem]'>
          <MockSidebar />

          {/* Main content area */}
          <div className='relative flex flex-1 flex-col'>
            {/* Chat indicator */}
            <div className='flex items-center justify-center py-4'>
              <div className='glass-panel backdrop-blur-panel backdrop-saturate-glass rounded-pill flex items-center gap-1 px-3 py-1.5'>
                <MessageCircle className='text-foreground h-3.5 w-3.5' />
                <span className='text-muted-foreground text-xs'>Chat</span>
              </div>
            </div>

            {/* Center greeting */}
            <div className='flex flex-1 flex-col items-center justify-center'>
              <p className='text-iris-title text-[2.5rem] font-medium tracking-[0.5em]'>IRIS</p>
              <p className='tracking-display text-iris-greeting mt-4 text-sm font-normal uppercase'>
                Good Afternoon, Max
              </p>
            </div>

            {/* Bottom input bar */}
            <div className='px-8 pb-5'>
              <div className='glass-panel backdrop-blur-panel backdrop-saturate-glass flex items-center gap-3 rounded-2xl px-4 py-3'>
                <div className='bg-surface/80 flex h-7 w-7 items-center justify-center rounded-lg'>
                  <Paperclip className='text-muted-foreground h-3.5 w-3.5' />
                </div>
                <div
                  className='h-5 w-5 rounded-full'
                  style={{
                    background:
                      'radial-gradient(circle, oklch(from var(--foreground) l c h / 80%) 0%, oklch(from var(--muted-foreground) l c h) 100%)',
                  }}
                />
                <span className='text-muted-foreground/70 flex-1 text-xs'>Chat with Iris...</span>
                <div className='bg-surface-raised flex h-7 w-7 items-center justify-center rounded-full'>
                  <ArrowUp className='text-background h-3.5 w-3.5' />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade — blends teaser into page end */}
      <div className='from-background pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t to-transparent' />
    </div>
  )
}
