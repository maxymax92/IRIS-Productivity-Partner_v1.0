'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

export interface UnderlineButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  thickness?: number
  duration?: number
}

export const UnderlineButton = React.forwardRef<HTMLButtonElement, UnderlineButtonProps>(
  ({ children, thickness = 2, duration = 0.3, className, ...props }, ref) => {
    return (
      <button
        className={cn(
          'group relative inline-flex items-center justify-center',
          'bg-transparent px-1 py-2 text-sm font-medium',
          'text-foreground',
          'cursor-pointer',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      >
        <span className='relative z-10 flex items-center gap-2'>{children}</span>

        {/* Underline that grows from center */}
        <span
          className='bg-primary absolute bottom-1 left-1/2 w-0 -translate-x-1/2 transition-all ease-out group-hover:w-full'
          style={{
            height: `${thickness}px`,
            transitionDuration: `${duration}s`,
          }}
        />
      </button>
    )
  },
)

UnderlineButton.displayName = 'UnderlineButton'
