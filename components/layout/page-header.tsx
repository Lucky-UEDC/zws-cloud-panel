import { Container } from "@/components/layout/container"
import { cn } from "@/lib/utils"

export function PageHeader({
  eyebrow,
  title,
  description,
  className,
  children,
  compact,
}: {
  eyebrow?: string
  title: string
  description?: string
  className?: string
  children?: React.ReactNode
  compact?: boolean
}) {
  return (
    <section className={cn("relative overflow-hidden", className)}>
      {/* Subtle accent glow halo to lift the header above the global dot field. */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[900px] -translate-x-1/2 rounded-full bg-accent/5 blur-3xl" />
      <Container className={cn("relative", compact ? "py-6 sm:py-8" : "py-16 sm:py-20 lg:py-24")}>
        <div className="flex max-w-3xl flex-col gap-4">
          {eyebrow && (
            <div className="glass inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="status-pulse absolute inset-0 rounded-full bg-accent" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              {eyebrow}
            </div>
          )}
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.05]">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
              {description}
            </p>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>
      </Container>
    </section>
  )
}
