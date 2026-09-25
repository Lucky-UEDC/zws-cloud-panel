"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { BACKGROUND_TOKENS } from "@/components/effects/background-tokens"

export function MouseGlowLayer({ className }: { className?: string }) {
  const glowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const glow = glowRef.current
    if (!glow) return

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const isTouchDevice = window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0

    const {
      size,
      blur,
      baseOpacity,
      reducedOpacity,
      ease,
      inactiveOpacity,
      maxDpr,
    } = BACKGROUND_TOKENS.mouseGlow

    const reducedPowerDevice = (window.devicePixelRatio || 1) > maxDpr || (navigator.hardwareConcurrency || 8) <= 4

    if (prefersReducedMotion || isTouchDevice) {
      glow.style.opacity = String(inactiveOpacity)
      return
    }

    let x = window.innerWidth * 0.5
    let y = window.innerHeight * 0.25
    let tx = x
    let ty = y
    let active = 0
    let targetActive = 0
    let raf = 0

    const targetOpacity = reducedPowerDevice ? reducedOpacity : baseOpacity

    const onMove = (e: MouseEvent) => {
      tx = e.clientX
      ty = e.clientY
      targetActive = 1
    }

    const onLeave = () => {
      targetActive = 0
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("mouseleave", onLeave)
    document.addEventListener("mouseleave", onLeave)

    const update = () => {
      x += (tx - x) * ease
      y += (ty - y) * ease
      active += (targetActive - active) * 0.08

      glow.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`
      glow.style.opacity = String(targetOpacity * active)
      glow.style.width = `${size}px`
      glow.style.height = `${size}px`
      glow.style.filter = `blur(${blur}px)`

      raf = requestAnimationFrame(update)
    }

    raf = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
      document.removeEventListener("mouseleave", onLeave)
    }
  }, [])

  return (
    <div aria-hidden="true" className={cn("decorative-layer pointer-events-none fixed inset-0 z-[1] overflow-hidden", className)} data-decorative-layer>
      <div
        ref={glowRef}
        className="pointer-events-none absolute rounded-full"
        style={{
          opacity: 0,
          background:
            "radial-gradient(circle at 50% 50%, rgba(0,212,255,0.18), rgba(0,212,255,0.06) 35%, rgba(0,212,255,0.01) 60%, transparent 75%)",
          willChange: "transform, opacity",
        }}
      />
    </div>
  )
}