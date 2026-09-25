"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"

type R2Config = {
  accountId: string
  bucket: string
  endpoint: string
  accessKey: string
  secretKey: string
}

const emptyConfig: R2Config = {
  accountId: "",
  bucket: "",
  endpoint: "",
  accessKey: "",
  secretKey: "",
}

function endpointFor(accountId: string) {
  const clean = accountId.trim()
  return clean ? `https://${clean}.r2.cloudflarestorage.com` : ""
}

export default function AdminIntegrationsPage() {
  const [config, setConfig] = useState<R2Config>(emptyConfig)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string[]>([])
  const [error, setError] = useState("")
  const endpoint = useMemo(() => endpointFor(config.accountId), [config.accountId])

  useEffect(() => {
    fetch("/api/admin/integrations/cloudflare-r2", { cache: "no-store" })
      .then(async (response) => {
        const data = await readJsonResponse<any>(response)
        if (!response.ok) throw new Error(data?.error || "Unable to load Cloudflare R2 configuration.")
        setConfig({ ...emptyConfig, ...(data.config || {}) })
      })
      .catch((loadError) => {
        toast.error(loadError instanceof Error ? loadError.message : "Unable to load Cloudflare R2 configuration.")
      })
  }, [])

  function patch(key: keyof R2Config, value: string) {
    setConfig((current) => ({ ...current, [key]: value }))
    setResult([])
    setError("")
  }

  function payload() {
    return { ...config, endpoint }
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/admin/integrations/cloudflare-r2", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Unable to save Cloudflare R2 configuration.")
      setConfig({ ...emptyConfig, ...(data.config || {}) })
      toast.success("Cloudflare R2 configuration saved")
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save Cloudflare R2 configuration."
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setResult([])
    setError("")
    try {
      const response = await fetch("/api/admin/integrations/cloudflare-r2/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok || data?.success === false) throw new Error(data?.error || "Cloudflare R2 connection test could not complete.")
      const steps = Array.isArray(data?.result?.steps) ? data.result.steps.map(String) : []
      setResult(steps)
      toast.success("Cloudflare R2 connection verified")
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : "Cloudflare R2 connection test could not complete."
      setError(message)
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold">Cloudflare R2</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="r2-account-id" label="Account ID"><Input id="r2-account-id" value={config.accountId} onChange={(event) => patch("accountId", event.target.value)} /></Field>
        <Field id="r2-bucket" label="Bucket Name"><Input id="r2-bucket" value={config.bucket} onChange={(event) => patch("bucket", event.target.value)} /></Field>
        <Field id="r2-endpoint" label="S3 Endpoint"><Input id="r2-endpoint" value={endpoint} readOnly /></Field>
        <Field id="r2-access-key" label="Access Key ID"><Input id="r2-access-key" type="password" value={config.accessKey} onChange={(event) => patch("accessKey", event.target.value)} /></Field>
        <Field id="r2-secret-key" label="Secret Access Key"><Input id="r2-secret-key" type="password" value={config.secretKey} onChange={(event) => patch("secretKey", event.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={save} disabled={saving}>{saving ? "Saving" : "Save"}</Button>
        <Button variant="outline" onClick={testConnection} disabled={testing}>{testing ? "Testing" : "Test Connection"}</Button>
      </div>
      {result.length ? <div className="space-y-1 text-sm text-emerald-500">{result.map((line) => <p key={line}>{line}</p>)}</div> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>
}
