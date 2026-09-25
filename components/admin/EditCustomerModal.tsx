"use client";

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function EditCustomerModal({ customer, onClose, onSave }: { customer: any; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    name: customer.name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    company: customer.company || "",
    addressLine1: customer.addressLine1 || "",
    addressLine2: customer.addressLine2 || "",
    city: customer.city || "",
    state: customer.state || "",
    country: customer.country || "India",
    postalCode: customer.postalCode || "",
    status: customer.status || "ACTIVE",
    role: customer.role || "customer",
    walletBalance: Number(customer.walletBalance || 0),
    walletAdjustment: "",
    walletReason: "",
    internalNotes: customer.internalNotes || "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");

    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      setSaving(false);
      return;
    }
    if (showPasswordField && form.newPassword !== form.confirmPassword) {
      setError("Passwords do not match.");
      setSaving(false);
      return;
    }
    if (form.walletAdjustment && !form.walletReason.trim()) {
      setError("Please provide a reason for the wallet adjustment.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          company: form.company,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          city: form.city,
          state: form.state,
          country: form.country,
          postalCode: form.postalCode,
          status: form.status,
          role: form.role,
          walletBalance: form.walletAdjustment ? Number(form.walletBalance) + Number(form.walletAdjustment) : form.walletBalance,
          walletReason: form.walletReason,
          internalNotes: form.internalNotes,
          password: showPasswordField ? form.newPassword : undefined,
        }),
      });

      if (!res.ok) {
        const data = await readJsonResponse<any>(res);
        throw new Error(data.error || "Failed to save.");
      }

      setSuccess("Customer updated successfully.");
      setTimeout(() => onSave(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unknown error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function sendPasswordResetEmail() {
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}/reset-password`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to send reset email");
      toast.success("Password reset email sent to " + customer.email);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "An unknown error occurred");
    }
  }

  const newBalance = form.walletAdjustment
    ? form.walletBalance + parseFloat(form.walletAdjustment || "0")
    : form.walletBalance;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Customer</DialogTitle>
          <DialogDescription>Update account fields, status, address, password, and wallet balance.</DialogDescription>
        </DialogHeader>

        {error && <div className="p-3 mb-4 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">{error}</div>}
        {success && <div className="p-3 mb-4 text-sm text-success bg-success/10 rounded-md border border-success/20">{success}</div>}

        <div className="space-y-8 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Basic Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+91 XXXXX XXXXX" />
              </div>
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input value={form.company} onChange={e => setForm({...form, company: e.target.value})} />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Address</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Address Line 1</Label>
                <Input value={form.addressLine1} onChange={e => setForm({...form, addressLine1: e.target.value})} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Address Line 2</Label>
                <Input value={form.addressLine2} onChange={e => setForm({...form, addressLine2: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>State / Province</Label>
                <Input value={form.state} onChange={e => setForm({...form, state: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setForm({...form, country: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>PIN / ZIP Code</Label>
                <Input value={form.postalCode} onChange={e => setForm({...form, postalCode: e.target.value})} />
              </div>
            </div>
          </div>

          {/* Account */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Account Settings</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Account Status</Label>
                <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="SUSPENDED">Suspended</SelectItem>
                    <SelectItem value="PENDING">Pending Verification</SelectItem>
                    <SelectItem value="BANNED">Banned</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm({...form, role: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="reseller">Reseller</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Wallet */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Wallet Balance</h3>
            <div className="p-3 rounded-lg bg-muted/50 flex justify-between items-center mb-4">
              <span className="text-sm">Current Balance: <strong className="text-foreground">₹{form.walletBalance.toLocaleString()}</strong></span>
              {form.walletAdjustment && (
                <span className="text-sm">→ New Balance: <strong className="text-foreground">₹{newBalance.toLocaleString()}</strong></span>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Adjustment Amount (use − for debit)</Label>
                <Input
                  type="number"
                  value={form.walletAdjustment}
                  onChange={e => setForm({...form, walletAdjustment: e.target.value})}
                  placeholder="e.g. 500 or -200"
                />
              </div>
              <div className="space-y-2">
                <Label>Reason for Change *</Label>
                <Input
                  value={form.walletReason}
                  onChange={e => setForm({...form, walletReason: e.target.value})}
                  placeholder="e.g. Refund for order #123"
                />
              </div>
            </div>
          </div>

          {/* Password */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Password Management</h3>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={sendPasswordResetEmail}>
                📧 Send Password Reset Email
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPasswordField(!showPasswordField)}
              >
                🔑 {showPasswordField ? "Cancel Manual Reset" : "Set New Password Manually"}
              </Button>
            </div>
            {showPasswordField && (
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    value={form.newPassword}
                    onChange={e => setForm({...form, newPassword: e.target.value})}
                    placeholder="Min 8 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <Input
                    type="password"
                    value={form.confirmPassword}
                    onChange={e => setForm({...form, confirmPassword: e.target.value})}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Admin Notes <span className="text-xs text-muted-foreground ml-2">(internal only)</span></h3>
            <Textarea
              value={form.internalNotes}
              onChange={e => setForm({...form, internalNotes: e.target.value})}
              rows={3}
              placeholder="Internal notes about this customer — not shown to the customer."
            />
          </div>
        </div>

        <DialogFooter className="gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
