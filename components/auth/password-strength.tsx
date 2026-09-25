"use client"

import { useMemo } from "react"
import { scorePassword } from "@/lib/auth-validation"
import { cn } from "@/lib/utils"

/**
 * Four-bar strength meter + hint text. Purely informational — the
 * actual "allow submit" rule lives next to the form (typically: score
 * must be >= 2 in signup, and all other fields valid).
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const result = useMemo(() => scorePassword(password), [password])
  const { score, label, hints } = result

  const barTone = (i: number) => {
    if (score === 0) return "bg-foreground/10"
    if (i < score) {
      if (score <= 1) return "bg-destructive/70"
      if (score === 2) return "bg-foreground/70"
      return "bg-accent"
    }
    return "bg-foreground/10"
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              barTone(i)
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span
          className={cn(
            "font-medium",
            score === 0 && "text-muted-foreground",
            score === 1 && "text-destructive",
            score === 2 && "text-muted-foreground",
            (score === 3 || score === 4) && "text-accent"
          )}
        >
          {password.length === 0 ? "Create a password" : label}
        </span>
        {hints.length > 0 && password.length > 0 && (
          <span className="text-muted-foreground">
            Add: {hints.slice(0, 2).join(", ")}
          </span>
        )}
      </div>
    </div>
  )
}
