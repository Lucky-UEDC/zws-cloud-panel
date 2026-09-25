import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function FeatureCard({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "glass glass-hover group relative flex flex-col gap-3 rounded-2xl p-6",
        className
      )}
    >
      <div className="glass inline-flex h-10 w-10 items-center justify-center rounded-xl text-accent transition-all group-hover:scale-[1.04]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
