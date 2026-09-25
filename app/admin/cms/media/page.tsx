"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, ImagePlus, Search, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"
import { cn } from "@/lib/utils"

export default function CmsMediaPage() {
  const [assets, setAssets] = useState<any[]>([])
  const [altText, setAltText] = useState("")
  const [search, setSearch] = useState("")
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function load() {
    const res = await fetch("/api/admin/cms/media", { cache: "no-store" })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (res.ok) setAssets(data.assets || [])
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assets
    return assets.filter((asset) => [asset.originalName, asset.optimizedName, asset.altText, asset.publicUrl].some((value) => String(value || "").toLowerCase().includes(q)))
  }, [assets, search])

  async function upload(file?: File) {
    if (!file) return
    const form = new FormData()
    form.set("file", file)
    form.set("altText", altText || file.name.replace(/\.[^.]+$/, ""))
    const res = await fetch("/api/admin/cms/media", { method: "POST", body: form })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (!res.ok) return toast.error(data.error || "Upload failed")
    toast.success("Image uploaded")
    setAltText("")
    if (inputRef.current) inputRef.current.value = ""
    await load()
  }

  async function saveAlt(asset: any, value: string) {
    const res = await fetch("/api/admin/cms/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: asset.id, altText: value }),
    })
    if (!res.ok) return toast.error("Failed to save alt text")
    toast.success("Alt text saved")
    await load()
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(url)
    window.setTimeout(() => setCopied(""), 1200)
  }

  async function deleteAsset(asset: any) {
    if (!confirm(`Delete ${asset.optimizedName || asset.originalName}?`)) return
    const res = await fetch(`/api/admin/cms/media?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Failed to delete media")
    toast.success("Media deleted")
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Media Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Upload, preview, search, and manage CMS images.</p>
        </div>
        <Button type="button" className="gap-2" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" />Upload</Button>
      </div>

      <Card className="glass border-border/40">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
          <div
            className={cn("flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/35 p-6 text-center transition-colors", dragging && "border-accent bg-accent/10")}
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              void upload(event.dataTransfer.files?.[0])
            }}
          >
            <ImagePlus className="h-8 w-8 text-accent" />
            <p className="mt-3 font-medium">Drop an image here</p>
            <p className="mt-1 text-sm text-muted-foreground">Images are converted to WebP automatically.</p>
            <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} />
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Alt text for next upload</Label>
              <Input value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Describe the image" />
            </div>
            <div className="space-y-2">
              <Label>Search media</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search images" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {filtered.map((asset) => (
          <MediaTile key={asset.id} asset={asset} copied={copied === asset.publicUrl} onCopy={() => copyUrl(asset.publicUrl)} onDelete={() => deleteAsset(asset)} onSaveAlt={saveAlt} />
        ))}
      </div>
      {!filtered.length ? <div className="rounded-lg border border-border/40 bg-background/35 p-10 text-center text-sm text-muted-foreground">No media assets found.</div> : null}
    </div>
  )
}

function MediaTile({ asset, copied, onCopy, onDelete, onSaveAlt }: { asset: any; copied: boolean; onCopy: () => void; onDelete: () => void; onSaveAlt: (asset: any, value: string) => void }) {
  const [alt, setAlt] = useState(asset.altText || "")
  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-background/35">
      <div className="relative aspect-square bg-background">
        {asset.publicUrl ? <Image src={asset.publicUrl} alt={asset.altText || asset.originalName} fill className="object-cover" sizes="260px" /> : null}
      </div>
      <div className="space-y-3 p-3">
        <div>
          <p className="truncate text-sm font-medium">{asset.optimizedName || asset.originalName}</p>
          <p className="truncate text-xs text-muted-foreground">{asset.publicUrl}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Alt text</Label>
          <Input value={alt} onChange={(event) => setAlt(event.target.value)} onBlur={() => alt !== (asset.altText || "") && onSaveAlt(asset, alt)} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" onClick={onCopy} disabled={!asset.publicUrl}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy URL"}
          </Button>
          <Button type="button" variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={onDelete} aria-label="Delete media">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
