import { Quote } from "lucide-react"
import { cn } from "@/lib/utils"

export function TestimonialCard({
  quote,
  author,
  role,
  company,
  className,
}: {
  quote: string
  author: string
  role: string
  company: string
  className?: string
}) {
  return (
    <figure
      className={cn(
        "glass glass-hover relative flex h-full flex-col justify-between gap-6 rounded-2xl p-6",
        className
      )}
    >
      <Quote
        aria-hidden
        className="absolute right-5 top-5 h-5 w-5 text-accent/40"
      />
      <blockquote className="text-pretty text-base leading-relaxed text-foreground/95">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="flex items-center gap-3">
        <div className="glass flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-foreground">
          {author.charAt(0)}
        </div>
        <div className="text-sm">
          <div className="font-medium text-foreground">{author}</div>
          <div className="text-muted-foreground">
            {role} · {company}
          </div>
        </div>
      </figcaption>
    </figure>
  )
}
