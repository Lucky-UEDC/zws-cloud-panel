"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { readJsonResponse } from "@/lib/client/safe-json"

export function AdminQuickSearch() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<any[]>([])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.ok ? readJsonResponse(res) : null)
        .then((data) => setResults(data?.results || []))
        .catch(() => null)
    }, 180)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [q])

  return (
    <div className="relative hidden w-[min(28rem,34vw)] lg:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search admin" className="h-9 bg-background/60 pl-9" />
      {results.length ? (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border border-border/40 bg-background shadow-2xl">
          {results.map((result, index) => (
            <Link key={`${result.href}-${index}`} href={result.href} onClick={() => { setQ(""); setResults([]) }} className="block border-b border-border/30 px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{result.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{result.type}</span>
              </div>
              {result.subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.subtitle}</p> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
