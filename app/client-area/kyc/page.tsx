"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Kyc = {
  status: string
  legalName: string
  taxId: string
  documentType: string
  documentNumber: string
  submittedAt: string | null
}

export default function ClientKycPage() {
  const [kyc, setKyc] = useState<Kyc>({
    status: "not_submitted",
    legalName: "",
    taxId: "",
    documentType: "",
    documentNumber: "",
    submittedAt: null,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await fetch("/api/client/profile")
      const data = await readJsonResponse<any>(res)
      if (res.ok) {
        setKyc((current) => data.profile?.kyc || current)
      }
    })()
  }, [])

async function submitKyc() {
    setSaving(true)
    try {
      const res = await fetch("/api/client/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kyc: {
            legalName: kyc.legalName,
            taxId: kyc.taxId,
            documentType: kyc.documentType,
            documentNumber: kyc.documentNumber,
          },
        }),
      })
      const data = await readJsonResponse<any>(res)

      if (!res.ok) {
        toast.error(data.error || "Failed to submit KYC")
        return
      }

      toast.success("KYC submitted for review")
      setKyc((prev) => ({ ...prev, status: "pending_review", submittedAt: new Date().toISOString() }))
    } catch {
      toast.error("Failed to submit KYC")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>KYC Verification</CardTitle>
          <CardDescription>Submit legal details for billing compliance and faster payment approvals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span>Status:</span>
            <Badge variant="outline" className="capitalize">{kyc.status.replaceAll("_", " ")}</Badge>
            {kyc.submittedAt ? <span className="text-muted-foreground">Submitted {new Date(kyc.submittedAt).toLocaleString()}</span> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Legal Name</Label>
              <Input value={kyc.legalName} onChange={(e) => setKyc({ ...kyc, legalName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Tax ID / GSTIN</Label>
              <Input value={kyc.taxId} onChange={(e) => setKyc({ ...kyc, taxId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Document Type</Label>
              <Input value={kyc.documentType} onChange={(e) => setKyc({ ...kyc, documentType: e.target.value })} placeholder="PAN, CIN, Passport" />
            </div>
            <div className="space-y-2">
              <Label>Document Number</Label>
              <Input value={kyc.documentNumber} onChange={(e) => setKyc({ ...kyc, documentNumber: e.target.value })} />
            </div>
          </div>

          <Button type="button" onClick={submitKyc} disabled={saving === true}>{saving ? "Submitting..." : "Submit KYC"}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
