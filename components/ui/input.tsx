import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-[var(--text-placeholder)] selection:bg-[var(--accent-soft)] selection:text-[var(--text-selected)] border-[var(--border-primary)] h-9 w-full min-w-0 rounded-md border bg-[var(--surface-subtle)] px-3 py-1 text-base text-[var(--text-primary)] shadow-xs transition-[border-color,box-shadow,background,color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-[var(--accent-primary)] focus-visible:ring-[3px] focus-visible:ring-[rgba(20,184,166,0.12)]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
