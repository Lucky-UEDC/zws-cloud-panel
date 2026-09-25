"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function AdminNewCustomerPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: "", name: "", phone: "", company: "", password: "" })

  async function submit() {
    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to create customer")
      return
    }
    toast.success("Customer created")
    router.push(`/admin/customers/${data.customer.id}`)
  }

  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Add Customer</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="space-y-2"><Label>Company</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
        <div className="space-y-2 md:col-span-2"><Label>Temporary Password (optional)</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div><Button onClick={submit}>Create Customer</Button></div>
      </CardContent>
    </Card>
  )
}
