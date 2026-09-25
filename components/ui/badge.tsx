import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-[rgba(20,184,166,0.12)] focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[background,border-color,color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default:
          'border-[var(--border-selected)] bg-[var(--accent-soft)] text-[var(--text-selected)] [a&]:hover:bg-[var(--accent-hover-soft)]',
        secondary:
          'border-[var(--border-primary)] bg-secondary text-secondary-foreground [a&]:hover:bg-[var(--surface-hover)]',
        destructive:
          'border-transparent bg-destructive text-[#fee2e2] [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border-[var(--border-primary)] text-[var(--text-secondary)] [a&]:hover:bg-[rgba(255,255,255,0.04)] [a&]:hover:text-[var(--text-primary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
