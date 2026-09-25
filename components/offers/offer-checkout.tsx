"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Image from "next/image"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { paymentClientMessage } from "@/lib/client/payment-errors"
import { getOsDescription, getOsFamily, getResolvedOsIcon, handleOsIconError } from "@/lib/os-icons"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  Network,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PhonePeBridgeModal } from "@/components/payments/PhonePeBridgeModal"
import { trackGaEvent } from "@/components/analytics/analytics-provider"

type Offer = {
  id: string
  name: string
  slug: string
  headline?: string | null
  description?: string | null
  planLabel?: string | null
  vcpu: number
  ramGb: number
  storageGb: number
  bandwidthTb: number | string
  baseMonthlyPrice: number | string
  offerMonthlyPrice: number | string
  gstEnabled?: boolean
  gstPercent: number | string
  billingTermsAllowed: number[]
  defaultBillingTerm: number
  defaultOsTemplateId?: string | null
  allowedOsFamilies?: string[]
  endsAt?: string | null
}

type OsTemplate = {
  id: string
  representativeTemplateId?: string | null
  name: string
  slug?: string | null
  osType?: string | null
  category?: string | null
  family?: string | null
  familyLabel?: string | null
  familyDescription?: string | null
  version?: string | null
  defaultUsername?: string | null
  recommended?: boolean
  isDefault?: boolean
  iconUrl?: string | null
  eolWarningText?: string | null
  proxmoxTemplateName?: string | null
}

type OfferCheckoutProps = {
  offer: Offer
  operatingSystems: OsTemplate[]
  paymentAvailable?: boolean
}

const FAMILY_LABELS: Record<string, string> = {
  ubuntu: "Ubuntu",
  debian: "Debian",
  almalinux: "AlmaLinux",
  rocky: "Rocky Linux",
  centos: "CentOS",
  windows: "Windows Server",
  linux: "Linux",
}

function formatPrice(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0))
}

function normalizeFamily(value: unknown) {
  return getOsFamily(String(value || ""))
}

function versionScore(template: OsTemplate) {
  const raw = `${template.version || ""} ${template.name || ""} ${template.slug || ""}`
  const matches = Array.from(raw.matchAll(/(\d+)(?:[._-](\d+))?/g))
  if (!matches.length) return 0
  const [major, minor] = matches[matches.length - 1].slice(1).map((item) => Number(item || 0))
  return major * 1000 + minor
}

function safeTemplateList(value: unknown): OsTemplate[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item: any) => ({
      id: String(item?.id || ""),
      representativeTemplateId: item?.representativeTemplateId ? String(item.representativeTemplateId) : null,
      name: String(item?.name || "Linux"),
      slug: item?.slug ? String(item.slug) : null,
      osType: item?.osType ? String(item.osType) : null,
      category: item?.category ? String(item.category) : null,
      family: item?.family ? String(item.family) : null,
      familyLabel: item?.familyLabel ? String(item.familyLabel) : null,
      familyDescription: item?.familyDescription ? String(item.familyDescription) : null,
      version: item?.version ? String(item.version) : null,
      defaultUsername: item?.defaultUsername ? String(item.defaultUsername) : (getOsFamily(item) === "windows" ? "Administrator" : "root"),
      recommended: Boolean(item?.recommended),
      isDefault: Boolean(item?.isDefault),
      iconUrl: item?.iconUrl ? String(item.iconUrl) : null,
      eolWarningText: item?.eolWarningText ? String(item.eolWarningText) : null,
      proxmoxTemplateName: item?.proxmoxTemplateName ? String(item.proxmoxTemplateName) : null,
    }))
    .filter((item) => item.id)
}

function logOfferCheckoutError(offerSlug: string, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error || "Unknown error"))
  console.error("[offer_checkout_submit_failed]", {
    offerSlug,
    message: err.message,
    stack: err.stack,
  })
}

export function OfferCheckout({ offer, operatingSystems, paymentAvailable = true }: OfferCheckoutProps) {
  const templates = useMemo(() => safeTemplateList(operatingSystems), [operatingSystems])
  const terms = Array.isArray(offer.billingTermsAllowed) && offer.billingTermsAllowed.length ? offer.billingTermsAllowed : [1]
  const allowedFamilies = useMemo(() => {
    const configured = Array.isArray(offer.allowedOsFamilies) ? offer.allowedOsFamilies.map(normalizeFamily).filter(Boolean) : []
    return configured.length ? configured : null
  }, [offer.allowedOsFamilies])

  const groupedFamilies = useMemo(() => {
    const groups = new Map<string, { family: string; label: string; description: string; iconUrl?: string | null; items: OsTemplate[] }>()
    for (const item of templates) {
      const family = getOsFamily({
        name: item.name,
        slug: item.slug,
        osFamily: item.family,
        family: item.family,
        familyLabel: item.familyLabel,
        category: item.category,
        proxmoxTemplateName: item.proxmoxTemplateName,
      })
      if (allowedFamilies && !allowedFamilies.includes(family)) continue
      const current = groups.get(family) || {
        family,
        label: item.familyLabel || FAMILY_LABELS[family] || item.name,
        description: item.familyDescription || getOsDescription(family),
        iconUrl: item.iconUrl,
        items: [],
      }
      if (!current.iconUrl && item.iconUrl) current.iconUrl = item.iconUrl
      current.items.push(item)
      groups.set(family, current)
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => {
            const resolved = getOsFamily({
              name: item.name,
              slug: item.slug,
              osFamily: item.family,
              family: item.family,
              familyLabel: item.familyLabel,
              category: item.category,
              proxmoxTemplateName: item.proxmoxTemplateName,
            })
            return resolved === group.family
          })
          .sort((a, b) => {
            if (Boolean(b.recommended || b.isDefault) !== Boolean(a.recommended || a.isDefault)) return Number(Boolean(b.recommended || b.isDefault)) - Number(Boolean(a.recommended || a.isDefault))
            return versionScore(b) - versionScore(a) || a.name.localeCompare(b.name)
          }),
      }))
      .filter((group) => group.items.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allowedFamilies, templates])

  const initialTemplate = useMemo(() => {
    const all = groupedFamilies.flatMap((group) => group.items)
    return all.find((item) => item.id === offer.defaultOsTemplateId) || all.find((item) => item.recommended || item.isDefault) || all[0] || null
  }, [groupedFamilies, offer.defaultOsTemplateId])

  const [term, setTerm] = useState(String(terms.includes(offer.defaultBillingTerm) ? offer.defaultBillingTerm : terms[0]))
  const [selectedFamily, setSelectedFamily] = useState(initialTemplate ? getOsFamily(initialTemplate) : groupedFamilies[0]?.family || "")
  const [osTemplateId, setOsTemplateId] = useState(initialTemplate?.id || "")
  const [osTab, setOsTab] = useState<"os" | "apps">("os")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [inlineError, setInlineError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [phonePeBridgeUrl, setPhonePeBridgeUrl] = useState<string | null>(null)
  const idempotencyRef = useRef<string | null>(null)

  useEffect(() => {
    function onBridge(event: Event) {
      const detail = (event as CustomEvent<{ bridgeUrl?: string }>).detail
      if (detail?.bridgeUrl) setPhonePeBridgeUrl(detail.bridgeUrl)
    }
    window.addEventListener("zws:payment-bridge", onBridge)
    return () => window.removeEventListener("zws:payment-bridge", onBridge)
  }, [])

  const familyVersions = useMemo(() => groupedFamilies.find((group) => group.family === selectedFamily)?.items || [], [groupedFamilies, selectedFamily])
  const selectedOs = useMemo(() => templates.find((item) => item.id === osTemplateId) || null, [templates, osTemplateId])
  const selectedAdminUser = selectedOs?.defaultUsername || (selectedOs && getOsFamily(selectedOs) === "windows" ? "Administrator" : "root")
  const hasDiscount = Number(offer.baseMonthlyPrice || 0) > Number(offer.offerMonthlyPrice || 0)
  const passwordRequirements = useMemo(() => passwordRequirementRows(password), [password])

  const pricing = useMemo(() => {
    const base = Number(offer.baseMonthlyPrice || 0)
    const final = Number(offer.offerMonthlyPrice || 0)
    const months = Number(term)
    const subtotal = Number((final * months).toFixed(2))
    const gst = offer.gstEnabled === false ? 0 : Number((subtotal * (Number(offer.gstPercent || 18) / 100)).toFixed(2))
    const payable = Number((subtotal + gst).toFixed(2))
    return {
      base,
      final,
      subtotal,
      gst,
      payable,
      renewal: payable,
      save: hasDiscount ? Math.round(((base - final) / Math.max(1, base)) * 100) : 0,
    }
  }, [hasDiscount, offer.baseMonthlyPrice, offer.gstEnabled, offer.gstPercent, offer.offerMonthlyPrice, term])

  function selectFamily(family: string) {
    const group = groupedFamilies.find((item) => item.family === family)
    const preferred = group?.items.find((item) => item.recommended || item.isDefault) || group?.items[0]
    setSelectedFamily(family)
    if (preferred) setOsTemplateId(preferred.id)
    setInlineError("")
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!osTemplateId) next.os = "Choose an operating system before payment."
    if (!paymentAvailable) next.payment = "Payment is temporarily unavailable. Please try again shortly."
    if (!terms.includes(Number(term))) next.term = "Choose an allowed billing term."
    if (passwordStrengthScore(password) < 2) next.password = "Use at least 8 characters with a mix of letters and numbers."
    setFieldErrors(next)
    return next
  }

  function generatePassword() {
    const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"]
    const charset = groups.join("")
    const bytes = new Uint8Array(18)
    globalThis.crypto?.getRandomValues(bytes)
    const required = groups.map((group, index) => group[bytes[index] % group.length])
    const rest = Array.from(bytes.slice(required.length), (byte) => charset[byte % charset.length])
    setPassword([...required, ...rest].sort(() => Math.random() - 0.5).join(""))
  }

  async function copyPassword() {
    if (!password || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(password).catch(() => null)
    toast.success("Password copied")
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInlineError("")
    const errors = validate()
    if (Object.keys(errors).length) return
    setSubmitting(true)
    try {
      trackGaEvent("begin_checkout", {
        value: pricing.payable,
        currency: "INR",
        items: [{ item_id: offer.id, item_name: offer.name }],
      })
      const storageKey = `zws:offer:${offer.slug}:idempotency-key`
      const idempotencyKey = idempotencyRef.current || window.sessionStorage?.getItem(storageKey) || window.crypto?.randomUUID?.() || `offer-${Date.now()}-${Math.random().toString(36).slice(2)}`
      idempotencyRef.current = idempotencyKey
      window.sessionStorage?.setItem(storageKey, idempotencyKey)
      const res = await fetch("/api/payments/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerSlug: offer.slug,
          term: Number(term),
          operatingSystemId: osTemplateId,
          operatingSystemFamily: selectedOs?.family,
          operatingSystemVersion: selectedOs?.version,
          adminUsername: selectedAdminUser,
          accessMethod: "PASSWORD",
          password,
          customerDetails: null,
          paymentMethod: "gateway",
          idempotencyKey,
          redirectTo: `${window.location.pathname}${window.location.search}`,
        }),
      })
      const body = await readJsonResponse<any>(res)
      if (!body) {
        throw new Error("Invalid payment response")
      }
      if (!res.ok || body?.ok === false || body?.success === false) {
        const requestId = String(body?.requestId || res.headers.get("x-request-id") || "").trim()
        const message = paymentClientMessage({
          code: body?.code,
          message: body?.error || body?.message,
          fallback: "Unable to start checkout",
        })
        if (body?.code === "login_required" || res.status === 401) setInlineError("Please login to continue with this launch offer.")
        else if (body?.code === "email_verification_required") setInlineError(body?.message || body?.error || "Please verify your email before payment. We sent a verification link to your inbox.")
        else setInlineError(requestId ? `${message} (Ref: ${requestId})` : message)
        throw new Error(requestId ? `${message} (Ref: ${requestId})` : message)
      }
      await startPaymentRedirect(body)
      window.sessionStorage?.removeItem(storageKey)
      idempotencyRef.current = null
    } catch (error: any) {
      const rawMessage = error?.message || ""
      const message = /fetch failed|failed to fetch|networkerror/i.test(rawMessage)
        ? "The payment service could not be reached. Try again shortly."
        : paymentClientMessage({ message: rawMessage, fallback: "Unable to start checkout" })
      logOfferCheckoutError(offer.slug, error)
      setInlineError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    {phonePeBridgeUrl ? <PhonePeBridgeModal bridgeUrl={phonePeBridgeUrl} onClose={() => setPhonePeBridgeUrl(null)} /> : null}
    <form onSubmit={submit} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <main className="min-w-0 space-y-8">
        <Panel>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Selected offer</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{offer.planLabel || offer.name}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Configure the operating system, login credentials, and billing term before secure payment.
              </p>
              {offer.endsAt ? (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                  <Clock className="h-3.5 w-3.5" /> Offer ends {new Date(offer.endsAt).toLocaleDateString("en-IN")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
              <Spec icon={Cpu} label="Compute" value={`${offer.vcpu} vCPU`} />
              <Spec icon={Database} label="Memory" value={`${offer.ramGb} GB RAM`} />
              <Spec icon={HardDrive} label="Storage" value={`${offer.storageGb} GB NVMe`} />
              <Spec icon={Network} label="Bandwidth" value={`${Number(offer.bandwidthTb || 0)} TB included`} />
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionTitle title="Billing period" description="Choose how long this launch offer should be billed before renewal." />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {terms.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setTerm(String(item))
                  setInlineError("")
                }}
                className={`rounded-xl border p-4 text-left transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px ${term === String(item) ? "selected-item" : "border-[var(--border-primary)] bg-[var(--surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{item} month{item === 1 ? "" : "s"}</span>
                  {hasDiscount ? <Badge variant="outline" className="text-emerald-400">Save {pricing.save}%</Badge> : null}
                </div>
                <p className="mt-2 text-xs">Manual renewal cycle: {item} month{item === 1 ? "" : "s"}.</p>
              </button>
            ))}
          </div>
          {fieldErrors.term ? <ErrorText>{fieldErrors.term}</ErrorText> : null}
        </Panel>

        <section id="offer-config" className="space-y-8">
          <Panel>
            <SectionTitle title="Choose Operating System" description="Select a server image. Disabled admin templates are hidden automatically." />
            <div className="mt-5 flex rounded-xl border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-1">
              <button type="button" onClick={() => setOsTab("os")} className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${osTab === "os" ? "selected-item" : "text-muted-foreground hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"}`}>Operating Systems</button>
              <button type="button" onClick={() => setOsTab("apps")} className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${osTab === "apps" ? "selected-item" : "text-muted-foreground hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"}`}>Applications coming soon</button>
            </div>
            {osTab === "apps" ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border/50 bg-foreground/[0.02] p-8 text-center text-sm text-muted-foreground">
                One-click application images are coming soon. Choose a Linux operating system for this launch offer.
              </div>
            ) : groupedFamilies.length ? (
              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {groupedFamilies.map((group) => {
                    const selected = selectedFamily === group.family
                    const recommended = group.items.some((item) => item.recommended || item.isDefault)
                    return (
                      <button
                        key={group.family}
                        type="button"
                        data-testid="offer-os-family-option"
                        onClick={() => selectFamily(group.family)}
                        className={`min-h-40 rounded-2xl border p-5 text-left transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px ${selected ? "selected-item" : "border-[var(--border-primary)] bg-[var(--surface-subtle)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-primary)] bg-[var(--surface-hover)]">
                            <Image src={getResolvedOsIcon({ name: group.label, family: group.family, familyLabel: group.label, iconUrl: group.iconUrl })} alt="" width={40} height={40} className="h-10 w-10 object-contain" onError={handleOsIconError} unoptimized />
                          </span>
                          {recommended ? <Badge variant="outline" className="select-none border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Recommended</Badge> : null}
                        </span>
                        <span className="mt-5 block text-base font-semibold">{group.label}</span>
                        <span className="mt-2 block text-sm text-muted-foreground">{group.description}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-5">
                  <p className="select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version selector</p>
                  <div className="mt-4 space-y-3">
                    {familyVersions.map((os) => (
                      <button
                        key={os.id}
                        type="button"
                        data-testid="offer-os-version-option"
                        onClick={() => {
                          setOsTemplateId(os.id)
                          setInlineError("")
                        }}
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px ${osTemplateId === os.id ? "selected-item" : "border-[var(--border-primary)] bg-transparent hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                      >
                        <span className="flex items-start gap-2">
                          <Image src={getResolvedOsIcon(os)} alt="" width={24} height={24} className="mt-0.5 h-6 w-6 object-contain" onError={handleOsIconError} unoptimized />
                          <span className="min-w-0">
                            <span className="block font-medium">{os.version || os.name}</span>
                            {(os.recommended || os.isDefault) ? <span className="text-xs text-emerald-300">Recommended</span> : null}
                          </span>
                        </span>
                        {os.eolWarningText ? <span className="mt-1 block text-xs text-amber-300">{os.eolWarningText}</span> : null}
                      </button>
                    ))}
                  </div>
                  <div className="mt-5 rounded-xl border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-4 text-sm text-[var(--text-muted)]">
                    <p>Selected version: <span className="font-medium text-foreground">{selectedOs?.version || selectedOs?.name || "Choose OS"}</span></p>
                    <p className="mt-2">Default login for this image: <span className="font-medium text-foreground">{selectedAdminUser}</span></p>
                  </div>
                  {fieldErrors.os ? <ErrorText>{fieldErrors.os}</ErrorText> : null}
                </div>
              </div>
            ) : (
              <ErrorBox>No operating system images are currently available.</ErrorBox>
            )}
          </Panel>

          <Panel>
            <SectionTitle title="Access Credentials" description={`Set the ${selectedAdminUser} login credentials for this instance.`} />
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <FieldError label="Admin user" error="">
                  <Input data-testid="offer-adminUser" value={selectedAdminUser} readOnly />
                </FieldError>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldError label="Password" error={fieldErrors.password}>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input data-testid="offer-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="pr-10" />
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button type="button" variant="outline" onClick={generatePassword}>Generate</Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => void copyPassword()} disabled={!password} aria-label="Copy password"><Copy className="h-4 w-4" /></Button>
                  </div>
                </FieldError>
                <div className="rounded-lg border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {passwordRequirements.map((item) => (
                      <span key={item.label} className={`flex items-center gap-1.5 ${item.met ? "text-emerald-300" : ""}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </section>
      </main>

      <aside className="min-w-0">
        <div className="glass glass-strong sticky top-24 rounded-3xl border border-border/60 p-5 shadow-2xl shadow-black/25 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="select-none">
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Offer Checkout</p>
              <h2 className="mt-1 text-xl font-semibold">Launch Offer</h2>
            </div>
            {hasDiscount ? <Badge variant="outline" className="select-none border-emerald-500/50 bg-emerald-500/10 text-emerald-300">Save {pricing.save}%</Badge> : null}
          </div>

          <div className="mt-6 rounded-2xl border border-border/50 bg-background/45 p-4">
            {hasDiscount ? <p className="text-sm text-muted-foreground line-through">Original Price: {formatPrice(offer.baseMonthlyPrice)}</p> : null}
            <p className="mt-1 text-4xl font-semibold tracking-tight">{formatPrice(offer.offerMonthlyPrice)}<span className="text-sm text-muted-foreground">/mo</span></p>
          </div>

          <div className="mt-6 rounded-2xl border border-border/45 bg-foreground/[0.025] p-4">
            <p className="select-none text-sm font-semibold">Selected configuration</p>
            <SummaryRow label="Compute" value={`${offer.vcpu} vCPU`} />
            <SummaryRow label="Memory" value={`${offer.ramGb} GB RAM`} />
            <SummaryRow label="Storage" value={`${offer.storageGb} GB NVMe`} />
            <SummaryRow label="Bandwidth" value={`${Number(offer.bandwidthTb || 0)} TB included`} />
            <SummaryRow label="OS" value={selectedOs ? `${selectedOs.familyLabel || FAMILY_LABELS[getOsFamily(selectedOs)] || selectedOs.name} ${selectedOs.version || ""}`.trim() : "Not selected"} />
            <SummaryRow label="Access" value={`${selectedAdminUser} password`} />
            <SummaryRow label="Billing" value={`${term} month${Number(term) === 1 ? "" : "s"}`} />
          </div>

          <div className="mt-5 rounded-2xl border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-4">
            <p className="select-none text-sm font-semibold">Payment</p>
            <SummaryRow label="Subtotal" value={formatPrice(pricing.subtotal)} />
            <SummaryRow label="GST" value={formatPrice(pricing.gst)} />
            <div className="mt-3 flex justify-between border-t border-[var(--border-selected)] pt-3 text-lg font-semibold">
              <span>Payable today</span>
              <span>{formatPrice(pricing.payable)}</span>
            </div>
            <SummaryRow label="Renewal amount" value={formatPrice(pricing.renewal)} />
          </div>

          {inlineError ? (
            <div className="mt-4 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              {inlineError}
              {inlineError.toLowerCase().includes("login") ? <> <Link href="/login" className="underline">Login</Link></> : null}
            </div>
          ) : null}
          {!paymentAvailable ? <ErrorBox>Payment is temporarily unavailable.</ErrorBox> : null}
          {fieldErrors.payment ? <ErrorBox>{fieldErrors.payment}</ErrorBox> : null}

          <Button type="submit" className="mt-5 w-full gap-2" disabled={submitting || groupedFamilies.length === 0 || !paymentAvailable}>
            {submitting ? "Starting secure payment..." : "Proceed to Secure Payment"}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="mt-3 select-none text-center text-xs text-muted-foreground">Secure checkout powered by the active payment gateway.</p>
        </div>
      </aside>
    </form>
    </>
  )
}

function Spec({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="select-none rounded-2xl border border-border/50 bg-background/50 p-4">
      <Icon className="mb-3 h-5 w-5 text-accent" />
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}

function passwordStrengthScore(password: string) {
  if (password.length < 8) return 0
  let classes = 0
  if (/[A-Z]/.test(password)) classes++
  if (/[a-z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^A-Za-z0-9]/.test(password)) classes++
  if (classes >= 4 && password.length >= 12) return 4
  if (classes >= 3 && password.length >= 10) return 3
  if (classes >= 2) return 2
  return 1
}

function passwordRequirementRows(password: string) {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
    { label: "Symbol", met: /[^A-Za-z0-9]/.test(password) },
  ]
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="surface-card rounded-3xl border p-5 sm:p-6">{children}</section>
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="select-none">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

function FieldError({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  )
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs text-destructive">{children}</p>
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 rounded-xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{children}</div>
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
