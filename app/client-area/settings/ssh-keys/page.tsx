"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Copy, Download, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SshKey = {
  id: string
  label: string
  name?: string
  publicKey: string
  fingerprint: string
  type: string
  source?: string | null
  isDefault: boolean
  createdAt: string
  lastUsedAt?: string | null
}

type GeneratedKey = {
  id: string | null
  name: string
  publicKey: string
  privateKey: string
  fingerprint: string
  filename: string
}

export default function SshKeysPage() {
  const [keys, setKeys] = useState<SshKey[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [savingPublicKey, setSavingPublicKey] = useState(false)
  const [generated, setGenerated] = useState<GeneratedKey | null>(null)
  const [generatedSaved, setGeneratedSaved] = useState(false)
  const [generateName, setGenerateName] = useState("")
  const [form, setForm] = useState({ name: "", publicKey: "" })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchKeys()
  }, [])

  const keyCount = keys.length
  const generatedCount = useMemo(() => keys.filter((key) => key.source === "generated").length, [keys])

  async function fetchKeys() {
    setLoading(true)
    try {
      const res = await fetch("/api/client/ssh-keys", { cache: "no-store" })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to load SSH keys")
      setKeys(Array.isArray(data) ? data : Array.isArray(data?.keys) ? data.keys : [])
    } catch (error: any) {
      toast.error(error?.message || "Failed to load SSH keys")
    } finally {
      setLoading(false)
    }
  }

  async function generateKey() {
    setGenerating(true)
    try {
      const res = await fetch("/api/client/ssh-keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: generateName || undefined, save: true }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to generate SSH key")
      setGenerated({
        id: data.id || data.keyId || data.savedKeyId || null,
        name: data.name || data.label || "zws-key",
        publicKey: data.publicKey,
        privateKey: data.privateKey,
        fingerprint: data.fingerprint,
        filename: data.filename || `cloud-${data.name || "ssh-key"}.pem`,
      })
      setGeneratedSaved(false)
      setGenerateName("")
      await fetchKeys()
      toast.success("SSH key generated")
    } catch (error: any) {
      toast.error(error?.message || "Failed to generate SSH key")
    } finally {
      setGenerating(false)
    }
  }

  async function addPublicKey() {
    if (!form.name.trim() || !form.publicKey.trim()) return toast.error("Key name and public key are required")
    setSavingPublicKey(true)
    try {
      const res = await fetch("/api/client/ssh-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), publicKey: form.publicKey.trim() }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to save key")
      setForm({ name: "", publicKey: "" })
      await fetchKeys()
      toast.success("SSH public key added")
    } catch (error: any) {
      toast.error(error?.message || "Failed to save key")
    } finally {
      setSavingPublicKey(false)
    }
  }

  async function deleteKey(id: string) {
    try {
      const res = await fetch(`/api/client/ssh-keys/${id}`, { method: "DELETE" })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Failed to delete key")
      setDeletingId(null)
      await fetchKeys()
      toast.success("SSH key deleted")
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete key")
    }
  }

  async function saveLabel(id: string) {
    if (!editingLabel.trim()) return toast.error("Key name is required")
    try {
      const res = await fetch(`/api/client/ssh-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingLabel.trim() }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Failed to update key")
      setEditingId(null)
      setEditingLabel("")
      await fetchKeys()
      toast.success("SSH key renamed")
    } catch (error: any) {
      toast.error(error?.message || "Failed to update key")
    }
  }

  function copy(text: string, message = "Copied to clipboard") {
    navigator.clipboard.writeText(text)
    toast.success(message)
  }

  function downloadPrivateKey() {
    if (!generated) return
    const blob = new Blob([generated.privateKey], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = generated.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setGeneratedSaved(true)
  }

  function startEditing(key: SshKey) {
    setEditingId(key.id)
    setEditingLabel(key.label)
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading SSH keys...</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Security</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">SSH Keys</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Manage public keys for secure server access outside checkout.</p>
        </div>
        <Button type="button" variant="outline" onClick={fetchKeys} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Saved keys" value={String(keyCount)} />
        <StatCard label="Generated keys" value={String(generatedCount)} />
        <StatCard label="Checkout access" value="Password only" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-6">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Saved SSH Keys</CardTitle>
              <CardDescription>Private keys are never shown in this list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {keys.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 p-12 text-center">
                  <KeyRound className="mb-4 h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">No SSH keys saved to your account.</p>
                </div>
              ) : (
                keys.map((key) => (
                  <div key={key.id} className="rounded-2xl border border-border/40 bg-foreground/[0.02] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {editingId === key.id ? (
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <Input value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} className="h-9 max-w-sm" />
                              <Button type="button" size="sm" onClick={() => saveLabel(key.id)}>Save</Button>
                              <Button type="button" size="icon" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel edit"><X className="h-4 w-4" /></Button>
                            </div>
                          ) : (
                            <h3 className="truncate text-lg font-medium">{key.label}</h3>
                          )}
                          <Badge variant="outline">{key.source === "generated" ? "Generated" : "Uploaded"}</Badge>
                          {key.isDefault ? <Badge>Default</Badge> : null}
                        </div>
                        <div className="mt-2 inline-flex max-w-full rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                          <span className="truncate">{key.fingerprint}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{key.type}</span>
                          <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                          <span>Last used {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}</span>
                        </div>
                        <div className="mt-4 rounded-lg bg-background/45 p-3 font-mono text-xs text-muted-foreground">
                          <p className="line-clamp-2 break-all">{key.publicKey}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => copy(key.publicKey, "Public key copied")}>
                          <Copy className="h-3.5 w-3.5" /> Copy public key
                        </Button>
                        {editingId !== key.id ? (
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => startEditing(key)}>
                            <Pencil className="h-3.5 w-3.5" /> Rename
                          </Button>
                        ) : null}
                        {deletingId === key.id ? (
                          <>
                            <Button type="button" variant="destructive" size="sm" onClick={() => deleteKey(key.id)}>Confirm delete</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setDeletingId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <Button type="button" variant="ghost" size="sm" className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeletingId(key.id)}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card className="glass border-accent/25">
            <CardHeader>
              <CardTitle>Generate New SSH Key</CardTitle>
              <CardDescription>Create an Ed25519 key pair and download the private key immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Key name</Label>
                <Input value={generateName} onChange={(event) => setGenerateName(event.target.value)} placeholder="zws-key-20260430-2045" />
              </div>
              <Button type="button" className="w-full gap-2" onClick={generateKey} disabled={generating}>
                <KeyRound className="h-4 w-4" /> {generating ? "Generating..." : "Generate Ed25519 key"}
              </Button>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                <AlertTriangle className="mb-2 h-4 w-4" />
                Download the private key when it is shown. It is not displayed in the saved key list.
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Add Existing Public Key</CardTitle>
              <CardDescription>Paste an ssh-ed25519 or ssh-rsa public key. Private keys are rejected.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Key name</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="My laptop" />
              </div>
              <div className="space-y-2">
                <Label>Public key</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border border-border/40 bg-background px-3 py-2 font-mono text-xs"
                  placeholder="ssh-ed25519 AAAAC3Nza..."
                  value={form.publicKey}
                  onChange={(event) => setForm({ ...form, publicKey: event.target.value })}
                />
              </div>
              <Button type="button" variant="outline" className="w-full gap-2" onClick={addPublicKey} disabled={savingPublicKey}>
                <Plus className="h-4 w-4" /> {savingPublicKey ? "Saving..." : "Add public key"}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      {generated ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border/60 bg-background p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Your private key is ready</h2>
                <p className="mt-2 text-sm text-muted-foreground">Download it now. You may not be able to view it again later.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setGenerated(null)} aria-label="Close"><X className="h-4 w-4" /></Button>
            </div>
            <div className="mt-5 rounded-xl border border-border/50 bg-foreground/[0.02] p-4">
              <p className="text-sm font-medium">{generated.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{generated.fingerprint}</p>
              <div className="mt-4 max-h-52 overflow-auto rounded-lg bg-background/70 p-3 font-mono text-xs whitespace-pre-wrap">{generated.privateKey}</div>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button type="button" className="gap-2" onClick={downloadPrivateKey}>
                <Download className="h-4 w-4" /> Download private key
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={() => copy(generated.publicKey, "Public key copied")}>
                <Copy className="h-4 w-4" /> Copy public key
              </Button>
              <Button type="button" variant={generatedSaved ? "default" : "outline"} className="gap-2" onClick={() => {
                setGeneratedSaved(true)
                setGenerated(null)
              }}>
                <ShieldCheck className="h-4 w-4" /> I have saved my private key
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-foreground/[0.025] p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
