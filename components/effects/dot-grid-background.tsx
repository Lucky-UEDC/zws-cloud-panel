"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { BACKGROUND_TOKENS } from "@/components/effects/background-tokens"

export function DotGridBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    const {
      spacing,
      baseRadius,
      baseAlpha,
      hoverAlpha,
      hoverRadiusBoost,
      influence,
      maxRepel,
      pointerEase,
      activeEase,
      maxDpr,
      targetFps,
    } = BACKGROUND_TOKENS.dotGrid

    const pointer = {
      x: -9999,
      y: -9999,
      tx: -9999,
      ty: -9999,
      active: 0,
      targetActive: 0,
    }

    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener("resize", resize, { passive: true })

    const onMove = (e: MouseEvent) => {
      pointer.tx = e.clientX
      pointer.ty = e.clientY
      pointer.targetActive = 1
    }

    const onLeave = () => {
      pointer.targetActive = 0
    }

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      pointer.tx = t.clientX
      pointer.ty = t.clientY
      pointer.targetActive = 1
    }

    const onTouchEnd = () => {
      pointer.targetActive = 0
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("mouseleave", onLeave)
    document.addEventListener("mouseleave", onLeave)
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", onTouchEnd)
    window.addEventListener("touchcancel", onTouchEnd)

    let raf = 0
    let lastDraw = 0

    const draw = (now: number) => {
      if (now - lastDraw < 1000 / targetFps) {
        raf = requestAnimationFrame(draw)
        return
      }
      lastDraw = now

      pointer.x += (pointer.tx - pointer.x) * pointerEase
      pointer.y += (pointer.ty - pointer.y) * pointerEase
      pointer.active += (pointer.targetActive - pointer.active) * activeEase

      ctx.clearRect(0, 0, width, height)

      const cols = Math.ceil(width / spacing) + 1
      const rows = Math.ceil(height / spacing) + 1
      const offsetX = (width - (cols - 1) * spacing) / 2
      const offsetY = (height - (rows - 1) * spacing) / 2

      const mx = pointer.x
      const my = pointer.y
      const act = pointer.active
      const influenceSq = influence * influence

      for (let i = 0; i < cols; i++) {
        const px0 = offsetX + i * spacing
        const colDx = px0 - mx
        const colFar = act > 0.01 && Math.abs(colDx) > influence

        for (let j = 0; j < rows; j++) {
          const py0 = offsetY + j * spacing

          let t = 0
          let dx = 0
          let dy = 0

          if (act > 0.01 && !colFar) {
            const ax = px0 - mx
            const ay = py0 - my
            const dSq = ax * ax + ay * ay

            if (dSq < influenceSq) {
              const dist = Math.sqrt(dSq)
              const n = 1 - dist / influence
              t = n * n * act

              const force = t * maxRepel
              const inv = dist > 0.0001 ? 1 / dist : 0
              dx = ax * inv * force
              dy = ay * inv * force
            }
          }

          const alpha = baseAlpha + (hoverAlpha - baseAlpha) * t
          const radius = baseRadius + hoverRadiusBoost * t

          ctx.beginPath()
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
          ctx.arc(px0 + dx, py0 + dy, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    if (prefersReducedMotion) {
      draw(0)
    } else {
      raf = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
      document.removeEventListener("mouseleave", onLeave)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [])

  return (
    <div aria-hidden="true" className={cn("decorative-layer pointer-events-none fixed inset-0 z-0 overflow-hidden", className)} data-decorative-layer>
      <canvas ref={canvasRef} className="pointer-events-none block h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 800px at 50% 0%, rgba(255,255,255,0.03), transparent 60%), radial-gradient(1000px 600px at 50% 100%, rgba(0,0,0,0.55), transparent 70%)",
        }}
      />
    </div>
  )
}