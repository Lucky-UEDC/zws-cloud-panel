import { cn } from "@/lib/utils"

function Block({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-md border border-border/20 bg-white/[0.055]", className)} />
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass rounded-lg border border-border/40 p-4", className)}>{children}</div>
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4"><Block className="h-9 w-56" /><Block className="h-10 w-32" /></div>
      <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Panel key={index}><Block className="h-5 w-24" /><Block className="mt-5 h-8 w-32" /><Block className="mt-3 h-3 w-full" /></Panel>)}</div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]"><Panel><Block className="h-7 w-40" /><Block className="mt-5 h-72 w-full" /></Panel><Panel><Block className="h-7 w-36" /><div className="mt-5 space-y-3">{Array.from({ length: 6 }).map((_, index) => <Block key={index} className="h-11 w-full" />)}</div></Panel></div>
    </div>
  )
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Panel className="overflow-hidden p-0">
      <div className="border-b border-border/30 p-4"><Block className="h-6 w-48" /></div>
      <div className="divide-y divide-border/25">{Array.from({ length: rows }).map((_, index) => <div key={index} className="grid grid-cols-5 gap-4 p-4"><Block className="h-5 w-full" /><Block className="h-5 w-3/4" /><Block className="h-5 w-2/3" /><Block className="h-5 w-1/2" /><Block className="h-8 w-24 justify-self-end" /></div>)}</div>
    </Panel>
  )
}

export function CheckoutSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <Panel><Block className="h-7 w-44" /><div className="mt-6 grid gap-4 md:grid-cols-2">{Array.from({ length: 6 }).map((_, index) => <Block key={index} className="h-12 w-full" />)}</div><Block className="mt-6 h-28 w-full" /></Panel>
      <Panel><Block className="h-7 w-36" /><div className="mt-6 space-y-4">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="flex justify-between gap-4"><Block className="h-4 w-28" /><Block className="h-4 w-20" /></div>)}</div><Block className="mt-6 h-11 w-full" /></Panel>
    </div>
  )
}

export function ProductCardSkeleton() {
  return <Panel><Block className="h-6 w-36" /><Block className="mt-4 h-4 w-full" /><Block className="mt-2 h-4 w-4/5" /><Block className="mt-6 h-10 w-32" /><div className="mt-6 space-y-2">{Array.from({ length: 4 }).map((_, index) => <Block key={index} className="h-4 w-full" />)}</div><Block className="mt-6 h-10 w-full" /></Panel>
}

export function AdminSidebarSkeleton() {
  return <div className="space-y-3 p-4">{Array.from({ length: 10 }).map((_, index) => <Block key={index} className="h-10 w-full rounded-lg" />)}</div>
}

export function AnalyticsSkeleton() {
  return <div className="space-y-4"><div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <Panel key={index}><Block className="h-5 w-28" /><Block className="mt-4 h-8 w-24" /></Panel>)}</div><Panel><Block className="h-7 w-44" /><Block className="mt-6 h-80 w-full" /></Panel></div>
}

export function InvoiceSkeleton() {
  return <Panel className="mx-auto max-w-4xl"><div className="flex justify-between gap-6"><Block className="h-12 w-40" /><Block className="h-20 w-56" /></div><div className="mt-10 space-y-3">{Array.from({ length: 7 }).map((_, index) => <Block key={index} className="h-10 w-full" />)}</div><div className="mt-8 flex justify-end"><Block className="h-28 w-72" /></div></Panel>
}
