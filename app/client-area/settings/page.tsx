"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { City, Country, State } from "country-state-city"
import Image from "next/image"
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from "next/link"
import PhoneInput from "react-phone-number-input"
import { Check, ChevronsUpDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"

type Profile = {
  id: string
  email: string
  name: string | null
  phone: string | null
  company: string | null
  address: {
    line1: string
    city: string
    state: string
    postalCode: string
    country: string
    countryCode?: string
    stateCode?: string
  }
  walletBalance: number
}

export default function ClientSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const missingBilling = searchParams.get("missing") === "billing"
  const returnTo = searchParams.get("return")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [setup, setSetup] = useState({ password: '', code: '', secret: '', qrCodeUrl: '', otpauthUri: '', backupCodes: [] as string[] })
  const [disable2fa, setDisable2fa] = useState({ password: '', code: '' })
  const [phoneChange, setPhoneChange] = useState({ newPhone: "", oldOtp: "", newOtp: "", oldVerified: false, busy: false })

  useEffect(() => {
    ;(async () => {
      const [profileRes, twoFactorRes] = await Promise.all([
        fetch('/api/client/profile'),
        fetch('/api/auth/2fa/status'),
      ])
      const profileData = await readJsonResponse<any>(profileRes)
      if (profileRes.ok) {
        setProfile(profileData.profile)
        const address = profileData.profile?.address || {}
        if (!address.country && !address.countryCode) {
          fetch("/api/geo", { cache: "no-store" })
            .then((res) => readJsonResponse<any>(res))
            .then((geo) => {
              const country = Country.getCountryByCode(String(geo?.countryCode || ""))
              if (country) {
                setProfile((current) => current ? {
                  ...current,
                  phone: current.phone || "",
                  address: { ...current.address, country: country.name, countryCode: country.isoCode },
                } : current)
              }
            })
            .catch(() => undefined)
        }
      }
      if (twoFactorRes.ok) {
        const twoFactorData = await readJsonResponse<any>(twoFactorRes)
        setTwoFactorEnabled(Boolean(twoFactorData.twoFactorEnabled))
      }
      setLoading(false)
    })()
  }, [])

  const countries = useMemo(() => Country.getAllCountries(), [])
  const selectedCountryCode = profile?.address.countryCode || countries.find((country) => country.name === profile?.address.country)?.isoCode || ""
  const states = useMemo(() => selectedCountryCode ? State.getStatesOfCountry(selectedCountryCode) : [], [selectedCountryCode])
  const selectedStateCode = profile?.address.stateCode || states.find((state) => state.name === profile?.address.state)?.isoCode || ""
  const cities = useMemo(() => selectedCountryCode && selectedStateCode ? City.getCitiesOfState(selectedCountryCode, selectedStateCode).slice(0, 100) : [], [selectedCountryCode, selectedStateCode])

  function patchAddress(patch: Partial<Profile["address"]>) {
    if (!profile) return
    setProfile({ ...profile, address: { ...profile.address, ...patch } })
  }

  function validateProfile() {
    if (!profile) return false
    const next: Record<string, string> = {}
    if (!profile.name?.trim()) next.name = "Full name is required"
    if (!profile.phone?.trim()) next.phone = "Phone number is required"
    if (!profile.address.line1?.trim()) next.line1 = "Address line is required"
    if (!profile.address.country?.trim()) next.country = "Country is required"
    if (states.length && !profile.address.state?.trim()) next.state = "State is required"
    if (!profile.address.city?.trim()) next.city = "City is required"
    const postal = profile.address.postalCode?.trim() || ""
    if (!postal) next.postalCode = "Postal code is required"
    else if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(postal)) next.postalCode = "Enter a valid postal code"
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (!profile) return
    if (!validateProfile()) return
    setSaving(true)
    try {
      const res = await fetch('/api/client/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, phone: profile.phone, company: profile.company, address: profile.address }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        toast.error(data.error || 'Failed to save settings')
        return
      }
      toast.success('Settings saved')
      if (returnTo) {
        router.push(returnTo)
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function phoneChangeAction(action: "start_old" | "verify_old" | "start_new" | "verify_new") {
    setPhoneChange((state) => ({ ...state, busy: true }))
    try {
      const res = await fetch("/api/client/security/phone-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          otp: action === "verify_old" ? phoneChange.oldOtp : phoneChange.newOtp,
          phone: phoneChange.newPhone,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        toast.error(data.error || "Phone verification failed")
        return
      }
      if (action === "verify_old") {
        setPhoneChange((state) => ({ ...state, oldVerified: true, oldOtp: "" }))
        toast.success("Old number verified")
      } else if (action === "verify_new") {
        setProfile((current) => current ? { ...current, phone: data.phone || phoneChange.newPhone } : current)
        setPhoneChange({ newPhone: "", oldOtp: "", newOtp: "", oldVerified: false, busy: false })
        toast.success("Phone number updated")
        return
      } else {
        toast.success(action === "start_old" ? "OTP sent to old number" : "OTP sent to new number")
      }
    } catch {
      toast.error("Phone verification failed")
    } finally {
      setPhoneChange((state) => ({ ...state, busy: false }))
    }
  }

  async function beginTwoFactorSetup() {
    const res = await fetch('/api/auth/2fa/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: setup.password }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || 'Failed to start 2FA setup')
      return
    }
    setSetup((state) => ({ ...state, secret: data.secret, qrCodeUrl: data.qrCodeUrl, otpauthUri: data.otpauthUri }))
    toast.success('Authenticator setup ready')
  }

  async function enableTwoFactor() {
    const res = await fetch('/api/auth/2fa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: setup.password, secret: setup.secret, code: setup.code }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || 'Failed to enable 2FA')
      return
    }
    setTwoFactorEnabled(true)
    setSetup({ password: '', code: '', secret: '', qrCodeUrl: '', otpauthUri: '', backupCodes: data.backupCodes || [] })
    toast.success('Two-factor authentication enabled')
  }

  async function disableTwoFactor() {
    const res = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disable2fa),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || 'Failed to disable 2FA')
      return
    }
    setTwoFactorEnabled(false)
    setDisable2fa({ password: '', code: '' })
    setSetup({ password: '', code: '', secret: '', qrCodeUrl: '', otpauthUri: '', backupCodes: [] })
    toast.success('Two-factor authentication disabled')
  }

  if (loading || !profile) {
    return <p className="text-sm text-muted-foreground">Loading settings...</p>
  }

  return (
    <div className="space-y-6">
      <Card id="billing-address" className="glass border-border/40">
        <CardHeader>
          <CardTitle>Client Settings</CardTitle>
          <CardDescription>Update your account, billing, and contact information.</CardDescription>
          {missingBilling ? <p className="text-xs text-amber-300">Complete billing address to continue checkout.</p> : null}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>Email</Label><Input value={profile.email} disabled /></div>
          <div className="space-y-2"><Label>Full Name</Label><Input value={profile.name || ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />{errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}</div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <PhoneInput
              international
              defaultCountry={(selectedCountryCode || "IN") as any}
              countryCallingCodeEditable={false}
              value={profile.phone || ""}
              disabled
              onChange={() => undefined}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            />
            <p className="text-xs text-muted-foreground">Use secure phone change below to update this number.</p>
          </div>
          <div className="space-y-2"><Label>Company</Label><Input value={profile.company || ''} onChange={(e) => setProfile({ ...profile, company: e.target.value })} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Address Line</Label><Input value={profile.address.line1} onChange={(e) => patchAddress({ line1: e.target.value })} />{errors.line1 ? <p className="text-xs text-destructive">{errors.line1}</p> : null}</div>
          <Combobox
            label="Country"
            value={selectedCountryCode}
            displayValue={profile.address.country}
            placeholder="Search country"
            items={countries.map((country) => ({ value: country.isoCode, label: country.name }))}
            onSelect={(value) => {
              const country = Country.getCountryByCode(value)
              patchAddress({ country: country?.name || "", countryCode: value, state: "", stateCode: "", city: "" })
            }}
            error={errors.country}
          />
          <Combobox
            label="State"
            value={selectedStateCode}
            displayValue={profile.address.state}
            placeholder={selectedCountryCode ? "Search state" : "Select country first"}
            items={states.map((state) => ({ value: state.isoCode, label: state.name }))}
            disabled={!selectedCountryCode || !states.length}
            onSelect={(value) => {
              const state = State.getStateByCodeAndCountry(value, selectedCountryCode)
              patchAddress({ state: state?.name || "", stateCode: value, city: "" })
            }}
            error={errors.state}
          />
          <Combobox
            label="City"
            value={profile.address.city}
            displayValue={profile.address.city}
            placeholder={selectedStateCode ? "Search city" : "Select state first"}
            items={cities.map((city) => ({ value: city.name, label: city.name }))}
            disabled={!selectedStateCode || !cities.length}
            onSelect={(value) => patchAddress({ city: value })}
            error={errors.city}
          />
          <div className="space-y-2"><Label>Postal Code</Label><Input value={profile.address.postalCode} onChange={(e) => patchAddress({ postalCode: e.target.value.toUpperCase() })} />{errors.postalCode ? <p className="text-xs text-destructive">{errors.postalCode}</p> : null}</div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="button" onClick={save} disabled={saving === true}>{saving ? 'Saving...' : 'Save Settings'}</Button>
            <Button asChild variant="outline"><Link href="/account/notifications">Notification Preferences</Link></Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Secure Phone Change</CardTitle>
          <CardDescription>Verify your old number first, then verify the new number before it is saved.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Old number OTP</Label>
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} value={phoneChange.oldOtp} onChange={(event) => setPhoneChange({ ...phoneChange, oldOtp: event.target.value.replace(/\D/g, "") })} />
              <Button type="button" variant="outline" onClick={() => phoneChangeAction("start_old")} disabled={phoneChange.busy}>Send</Button>
              <Button type="button" onClick={() => phoneChangeAction("verify_old")} disabled={phoneChange.busy || phoneChange.oldOtp.length !== 6}>Verify</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>New number</Label>
            <PhoneInput
              international
              defaultCountry={(selectedCountryCode || "IN") as any}
              countryCallingCodeEditable={false}
              value={phoneChange.newPhone}
              onChange={(value) => setPhoneChange({ ...phoneChange, newPhone: value || "" })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>New number OTP</Label>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" inputMode="numeric" maxLength={6} value={phoneChange.newOtp} onChange={(event) => setPhoneChange({ ...phoneChange, newOtp: event.target.value.replace(/\D/g, "") })} />
              <Button type="button" variant="outline" onClick={() => phoneChangeAction("start_new")} disabled={phoneChange.busy || !phoneChange.oldVerified || !phoneChange.newPhone}>Send to New</Button>
              <Button type="button" onClick={() => phoneChangeAction("verify_new")} disabled={phoneChange.busy || !phoneChange.oldVerified || phoneChange.newOtp.length !== 6}>Verify and Update</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>{twoFactorEnabled ? 'This account currently requires an authenticator app during login.' : 'Add an authenticator app as a second sign-in step.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {twoFactorEnabled ? (
            <>
              <div className="space-y-2"><Label>Current Password</Label><Input type="password" value={disable2fa.password} onChange={(e) => setDisable2fa({ ...disable2fa, password: e.target.value })} /></div>
              <div className="space-y-2"><Label>Authenticator Code</Label><Input value={disable2fa.code} onChange={(e) => setDisable2fa({ ...disable2fa, code: e.target.value })} /></div>
              <div className="md:col-span-2"><Button variant="destructive" onClick={disableTwoFactor}>Disable 2FA</Button></div>
            </>
          ) : (
            <>
              <div className="space-y-2"><Label>Confirm Password</Label><Input type="password" value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} /></div>
              <div className="flex items-end"><Button onClick={beginTwoFactorSetup}>Generate Setup</Button></div>
              {setup.secret ? (
                <>
                  <div className="space-y-2"><Label>Authenticator Secret</Label><Input value={setup.secret} readOnly /></div>
                  <div className="space-y-2"><Label>Scan QR Code</Label><div className="rounded-lg border border-border/40 bg-white p-3 inline-flex"><Image src={setup.qrCodeUrl} alt="Authenticator QR code" width={176} height={176} className="h-44 w-44" unoptimized /></div></div>
                  <div className="space-y-2 md:col-span-2"><Label>otpauth URI</Label><Input value={setup.otpauthUri} readOnly /></div>
                  <div className="space-y-2"><Label>Verification Code</Label><Input value={setup.code} onChange={(e) => setSetup({ ...setup, code: e.target.value })} /></div>
                  <div className="flex items-end"><Button onClick={enableTwoFactor}>Verify and Enable</Button></div>
                </>
              ) : null}
              {setup.backupCodes.length ? <div className="md:col-span-2 rounded-lg border border-border/40 bg-background/30 p-3"><p className="mb-2 text-sm font-medium">Backup codes</p><div className="grid gap-2 sm:grid-cols-2">{setup.backupCodes.map((code) => <code key={code} className="rounded bg-background px-2 py-1 text-xs">{code}</code>)}</div></div> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Combobox({
  label,
  value,
  displayValue,
  placeholder,
  items,
  onSelect,
  disabled,
  error,
}: {
  label: string
  value: string
  displayValue?: string
  placeholder: string
  items: Array<{ value: string; label: string }>
  onSelect: (value: string) => void
  disabled?: boolean
  error?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between px-3 font-normal" disabled={disabled}>
            <span className="truncate">{displayValue || placeholder}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>No result found.</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={`${label}-${item.value}`}
                    value={`${item.label} ${item.value}`}
                    onSelect={() => {
                      onSelect(item.value)
                      setOpen(false)
                    }}
                  >
                    <Check className={cn("h-4 w-4", value === item.value ? "opacity-100" : "opacity-0")} />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
