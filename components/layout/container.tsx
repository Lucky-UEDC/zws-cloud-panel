import { cn } from "@/lib/utils"
import type { HTMLAttributes } from "react"

export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1600px] px-4 sm:px-5 lg:px-6", className)}
      {...props}
    />
  )
}
