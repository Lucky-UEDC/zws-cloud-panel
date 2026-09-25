"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { UploadCloud } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

export default function WhatsAppMediaPage() {
  const [assets, setAssets] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/whatsapp/media", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setAssets(data.assets || [])
  }, [])

  useEffect(() => { void load() }, [load])

  async function upload(file: File | null) {
    if (!file) return
    setUploading(true)
    setProgress(20)
    const formData = new FormData()
    formData.set("file", file)
    const response = await fetch("/api/admin/whatsapp/media", { method: "POST", body: formData })
    setProgress(90)
    const data = await readJsonResponse<any>(response)
    setUploading(false)
    setProgress(0)
    if (!response.ok) {
      toast.error(data.error || "Upload failed")
      return
    }
    toast.success("Media asset uploaded")
    await load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">WhatsApp Media Library</h1>
        <p className="text-sm text-muted-foreground">Reusable JPG, PNG, WEBP, MP4, and PDF assets for media-first campaigns and templates.</p>
      </div>

      <Card>
        <CardContent
          className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void upload(event.dataTransfer.files?.[0] || null)
          }}
        >
          <UploadCloud className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Drop media here or click to upload</p>
            <p className="text-sm text-muted-foreground">Local storage is active; S3/R2/Bunny adapters use the same asset record shape.</p>
          </div>
          <input ref={inputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" onChange={(event) => void upload(event.target.files?.[0] || null)} />
          <Button type="button" variant="outline">Choose file</Button>
          {uploading ? <div className="w-full max-w-sm"><Progress value={progress} /></div> : null}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {assets.map((asset) => (
          <Card key={asset.id} className="overflow-hidden">
            <div className="flex aspect-video items-center justify-center bg-muted">
              {asset.mediaType === "image" && asset.publicUrl ? (
                <Image src={asset.publicUrl} alt={asset.originalName} width={480} height={270} className="h-full w-full object-cover" unoptimized />
              ) : (
                <span className="text-sm text-muted-foreground">{asset.mediaType.toUpperCase()}</span>
              )}
            </div>
            <CardHeader className="pb-2"><CardTitle className="truncate text-sm">{asset.originalName}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{asset.mediaType}</Badge>
                <Badge variant="outline">{asset.storageProvider}</Badge>
              </div>
              <p>{Math.round(Number(asset.size || 0) / 1024)} KB · {asset.mimeType}</p>
              {asset.width && asset.height ? <p>{asset.width} x {asset.height}</p> : null}
              <p className="truncate">{asset.publicUrl || asset.storagePath}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
