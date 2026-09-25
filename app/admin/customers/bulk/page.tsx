"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const COUNT_OPTIONS = [100, 500, 1000, 5000]

type Result = {
  created: number
  failed: number
  skipped: number
  count: number
  startIndex: number
  message: string
  errors?: string[]
  dryRun?: boolean
  previewEmails?: string[]
}

export default function AdminBulkAccountsPage() {
  const [count, setCount] = useState(100)
  const [emailPrefix, setEmailPrefix] = useState("")
  const [domain, setDomain] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function submit(dryRun = false) {
    if (!emailPrefix || !domain || !password) {
      toast.error("All fields are required")
      return
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    if (password.length < 12) {
      toast.error("Password must be at least 12 characters")
      return
    }

    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/admin/customers/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, emailPrefix, domain, defaultPassword: password, dryRun }),
      })
      const data: Result & { error?: string } = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Bulk creation failed")
        return
      }
      setResult(data)
      toast.success(data.message || `Created ${data.created} accounts`)
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulk Account Creation</h1>
        <p className="text-sm text-muted-foreground mt-1">Create multiple customer accounts for production migration support</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Account Count</Label>
            <div className="flex gap-2 mt-1">
              {COUNT_OPTIONS.map((opt) => (
                <Button
                  key={opt}
                  variant={count === opt ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCount(opt)}
                >
                  {opt.toLocaleString()}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="emailPrefix">Email Prefix</Label>
              <Input
                id="emailPrefix"
                placeholder="user"
                value={emailPrefix}
                onChange={(e) => setEmailPrefix(e.target.value.toLowerCase())}
              />
              <p className="text-xs text-muted-foreground mt-1">e.g. &quot;user&quot; → user1@domain.com</p>
            </div>
            <div>
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value.toLowerCase())}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="password">Default Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 12 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          {emailPrefix && domain && (
            <p className="text-sm text-muted-foreground">
              Will create: <strong>{emailPrefix}1@{domain}</strong>, <strong>{emailPrefix}2@{domain}</strong>, …
              <strong> {emailPrefix}{count}@{domain}</strong>
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => submit(true)} disabled={loading}>
              {loading ? "Running..." : "Dry Run Preview"}
            </Button>
            <Button onClick={() => submit(false)} disabled={loading}>
              {loading ? "Creating..." : `Create ${count.toLocaleString()} Accounts`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>{result.dryRun ? "Dry Run Preview" : "Creation Results"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.dryRun ? (
              <>
                <p className="text-sm">{result.message}</p>
                {result.previewEmails && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Sample emails:</p>
                    <ul className="text-sm space-y-1">
                      {result.previewEmails.map((email) => (
                        <li key={email} className="font-mono">{email}</li>
                      ))}
                      <li className="text-muted-foreground">…and {result.count - result.previewEmails.length} more</li>
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-300">{result.created}</p>
                    <p className="text-xs text-muted-foreground">Created</p>
                  </div>
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                    <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{result.skipped}</p>
                    <p className="text-xs text-muted-foreground">Skipped</p>
                  </div>
                  <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                    <p className="text-2xl font-bold text-red-700 dark:text-red-300">{result.failed}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                </div>
                <p className="text-sm text-center text-muted-foreground">{result.message}</p>
                {result.errors && result.errors.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-600 mb-1">Sample errors:</p>
                    <ul className="text-xs space-y-1 font-mono">
                      {result.errors.map((e, i) => (
                        <li key={i} className="text-red-600">{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
