"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { ArrowRight, Check, CheckCircle2, ChevronsUpDown, Clock, CreditCard, MessageCircle, Server, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { PhonePeBridgeModal } from "@/components/payments/PhonePeBridgeModal"
import { trackGaEvent } from "@/components/analytics/analytics-provider"
import { readJsonResponse } from "@/lib/client/safe-json"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { paymentClientMessage } from "@/lib/client/payment-errors"
import { formatPrice } from "@/lib/pricing"
import { cn } from "@/lib/utils"
import { clearCheckoutResumeIntent, readCheckoutResumeIntent, writeCheckoutResumeIntent } from "@/lib/client/checkout-resume"

type Product = {
  id: string
  slug: string
  name: string
  description?: string | null
  shortDescription?: string | null
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType: string
  bandwidthTb: number
  price1m: number
  billingTerms: number[]
  features: string[]
  specs?: Record<string, unknown>
  dedicatedSettings: {
    deliverySlaHours: number
    bandwidthLabel: string
    location: string
    setupFee: number
    purchaseEnabled: boolean
    whatsappEnabled: boolean
  }
}

type DedicatedOsOption = {
  id: string
  family: string
  familyLabel: string
  name: string
  version?: string | null
  slug: string
  iconUrl?: string | null
  description?: string | null
  isRecommended?: boolean
}

type CheckoutBootstrap = {
  product: Product
  osOptions: DedicatedOsOption[]
  term: number
  quote: { monthly: number; subtotal: number; taxAmount: number; total: number; setupFee: number }
}

type WindowsLicenseOption = "none" | "standard" | "datacenter"

const TERM_LABELS: Record<number, string> = {
  1: "Monthly",
  3: "3 Months",
  6: "6 Months",
  12: "1 Year",
  24: "2 Years",
  36: "3 Years",
}

function hostnameValid(value: string) {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)
}

function groupedOptions(options: DedicatedOsOption[]) {
  const groups = new Map<string, DedicatedOsOption[]>()
  for (const option of options) {
    groups.set(option.familyLabel, [...(groups.get(option.familyLabel) || []), option])
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }))
}

export function DedicatedCheckoutContent({ bootstrap, brandName = "Cloud" }: { bootstrap: CheckoutBootstrap; brandName?: string }) {
  const [term, setTerm] = useState(bootstrap.term)
  const [osOptionId, setOsOptionId] = useState(bootstrap.osOptions.find((os) => os.isRecommended)?.id || bootstrap.osOptions[0]?.id || "")
  const [osOpen, setOsOpen] = useState(false)
  const [hostname, setHostname] = useState(`${bootstrap.product.slug}-01`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 63))
  const [installationNotes, setInstallationNotes] = useState("")
  const [sshPublicKey, setSshPublicKey] = useState("")
  const [ipmiRequired, setIpmiRequired] = useState(false)
  const [couponCode, setCouponCode] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<"gateway" | "wallet">("gateway")
  const [walletBalance, setWalletBalance] = useState(0)
  const [authenticated, setAuthenticated] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [resumeChecked, setResumeChecked] = useState(false)
  const [windowsLicenseOption, setWindowsLicenseOption] = useState<WindowsLicenseOption>("none")
  const [submitting, setSubmitting] = useState(false)
  const [phonePeBridgeUrl, setPhonePeBridgeUrl] = useState<string | null>(null)
  const product = bootstrap.product
  const selectedOs = bootstrap.osOptions.find((os) => os.id === osOptionId) || null
  const termOptions = (Array.isArray(product.billingTerms) ? product.billingTerms : [1, 3, 6, 12, 24, 36]).filter((value) => [1, 3, 6, 12, 24, 36].includes(Number(value)))
  const monthly = term === bootstrap.term ? bootstrap.quote.monthly : product.price1m
  const isWindows = /windows/i.test(`${selectedOs?.family || ""} ${selectedOs?.familyLabel || ""} ${selectedOs?.name || ""}`)
  const windowsLicenseFee = isWindows && windowsLicenseOption !== "none" ? 800 : 0
  const windowsSetupFee = isWindows && windowsLicenseOption !== "none" ? 500 : 0
  const setupFee = (product.dedicatedSettings.setupFee || 0) + windowsSetupFee + windowsLicenseFee
  const subtotal = monthly * term + setupFee
  const taxAmount = Number((subtotal * 0.18).toFixed(2))
  const total = Number((subtotal + taxAmount).toFixed(2))
  const canUseWallet = walletBalance >= total && total > 0
  const groups = useMemo(() => groupedOptions(bootstrap.osOptions), [bootstrap.osOptions])
  const currentCheckoutUrl = () => typeof window === "undefined" ? "/dedicated/checkout" : `${window.location.pathname}${window.location.search || ""}`

  function storeResumeIntent(paymentRequested: boolean) {
    writeCheckoutResumeIntent({
      url: currentCheckoutUrl(),
      paymentRequested,
      draft: {
        product: product.slug || product.id,
        term,
        hostname,
        os: osOptionId,
        quantity: 1,
        coupon: couponCode.trim(),
        configuration: {
          dedicatedOsOptionId: osOptionId,
          installationNotes,
          sshPublicKeyPresent: Boolean(sshPublicKey.trim()),
          ipmiRequired,
          paymentMethod,
          windowsLicenseOption,
        },
      },
    })
  }

  useEffect(() => {
    function onBridge(event: Event) {
      const detail = (event as CustomEvent<{ bridgeUrl?: string }>).detail
      if (detail?.bridgeUrl) setPhonePeBridgeUrl(detail.bridgeUrl)
    }
    window.addEventListener("zws:payment-bridge", onBridge)
    return () => window.removeEventListener("zws:payment-bridge", onBridge)
  }, [])

  useEffect(() => {
    fetch("/api/client/profile", { cache: "no-store" })
      .then((res) => (res.ok ? readJsonResponse<any>(res) : null))
      .then((data) => {
        if (data?.profile) {
          setAuthenticated(true)
          setWalletBalance(Number(data.profile.walletBalance || 0))
        }
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (resumeChecked || !authenticated) return
    const intent = readCheckoutResumeIntent()
    setResumeChecked(true)
    if (!intent?.paymentRequested || intent.url !== currentCheckoutUrl()) return
    clearCheckoutResumeIntent()
    window.setTimeout(() => {
      document.querySelector<HTMLFormElement>("[data-dedicated-checkout-form]")?.requestSubmit()
    }, 250)
  }, [authenticated, resumeChecked])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authenticated) {
      storeResumeIntent(true)
      setAuthModalOpen(true)
      return
    }
    if (!osOptionId) return toast.error("Select an operating system or platform.")
    if (!hostnameValid(hostname)) return toast.error("Enter a valid hostname.")
    if (paymentMethod === "wallet" && !canUseWallet) return toast.error("Insufficient wallet balance.")
    setSubmitting(true)
    try {
      trackGaEvent("begin_checkout", {
        value: subtotal,
        currency: "INR",
        items: [{ item_id: product.id, item_name: product.name }],
      })
      const res = await fetch("/api/payments/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderType: "dedicated",
          productId: product.id,
          purpose: "order_payment",
          term,
          amount: subtotal,
          monthlyAmount: monthly,
          couponCode: couponCode.trim() || undefined,
          dedicatedOsOptionId: osOptionId,
          hostname,
          installationNotes,
          sshPublicKey: sshPublicKey.trim() || undefined,
          ipmiRequired,
          windowsLicenseOption,
          paymentMethod,
          redirectTo: `${globalThis.location.pathname}${globalThis.location.search}`,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        if (data?.code === "login_required") {
          storeResumeIntent(true)
          setAuthModalOpen(true)
          return
        }
        if (data?.code === "profile_incomplete") {
          toast.error("Please complete your profile before payment.")
          globalThis.location.assign("/client-area/settings")
          return
        }
        if (data?.code === "email_verification_required") {
          toast.error(data?.message || "Verify your email before payment.")
          return
        }
        const requestId = String(data?.requestId || res.headers.get("x-request-id") || "").trim()
        const mapped = paymentClientMessage({
          code: data?.code,
          message: data?.message || data?.error,
          fallback: "Unable to start payment.",
        })
        throw new Error(requestId ? `${mapped} (Ref: ${requestId})` : mapped)
      }
      await startPaymentRedirect(data)
    } catch (error: any) {
      const rawMessage = error?.message || ""
      toast.error(
        /fetch failed|failed to fetch|networkerror/i.test(rawMessage)
          ? "The payment service could not be reached. Try again shortly."
          : paymentClientMessage({ message: rawMessage, fallback: "Unable to start payment." }),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {phonePeBridgeUrl ? <PhonePeBridgeModal bridgeUrl={phonePeBridgeUrl} onClose={() => setPhonePeBridgeUrl(null)} /> : null}
      <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue your order</DialogTitle>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button asChild>
              <a href={`/login?next=${encodeURIComponent(currentCheckoutUrl())}`}>Login</a>
            </Button>
            <Button asChild variant="outline">
              <a href={`/register?next=${encodeURIComponent(currentCheckoutUrl())}`}>Create Account</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form data-dedicated-checkout-form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-5">
          <div>
            <a href="/dedicated" className="text-sm text-muted-foreground hover:text-foreground">Back to Dedicated Servers</a>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Bare Metal Server</Badge>
              <Badge variant="outline">Delivered within {product.dedicatedSettings.deliverySlaHours} hours</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Configure {product.name}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">Manual provisioning by {brandName} engineers after payment confirmation.</p>
          </div>

          <section className="rounded-lg border border-border/40 bg-foreground/[0.03] p-5">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" />
              <h2 className="font-semibold">Selected Dedicated Server</h2>
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Spec label="CPU Model" value={String(product.specs?.cpuModel || product.features.find((f) => /cpu:/i.test(f))?.replace(/cpu:\s*/i, "") || product.name)} />
              <Spec label="Cores / Threads" value={`${product.cpuCores} cores`} />
              <Spec label="RAM" value={`${product.ramGb} GB`} />
              <Spec label="Storage" value={`${product.storageGb} GB ${product.storageType.toUpperCase()}`} />
              <Spec label="Bandwidth" value={product.dedicatedSettings.bandwidthLabel || `${product.bandwidthTb} TB`} />
              <Spec label="Location" value={product.dedicatedSettings.location || "India"} />
              <Spec label="Setup time" value={`Delivery within ${product.dedicatedSettings.deliverySlaHours} hours after payment confirmation`} />
              <Spec label="Monthly price" value={`${formatPrice(monthly)}/mo`} />
            </div>
          </section>

          {isWindows ? (
            <section className="rounded-lg border border-border/40 bg-foreground/[0.03] p-5">
              <h2 className="font-semibold">Windows Licensing</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  { value: "none", label: "No License", price: 0 },
                  { value: "standard", label: "Windows Standard", price: 1300 },
                  { value: "datacenter", label: "Windows Datacenter", price: 1300 },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWindowsLicenseOption(option.value as WindowsLicenseOption)}
                    className={`rounded-md border px-3 py-3 text-left text-sm ${windowsLicenseOption === option.value ? "selected-item" : "border-border/40 hover:bg-[rgba(255,255,255,0.04)]"}`}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.price ? `${formatPrice(option.price)} one-time` : "Bring your own license"}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-border/40 bg-foreground/[0.03] p-5">
            <h2 className="font-semibold">Billing Term</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {termOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTerm(Number(value))}
                  className={`rounded-md border px-3 py-3 text-left text-sm ${term === Number(value) ? "selected-item" : "border-border/40 hover:bg-[rgba(255,255,255,0.04)]"}`}
                >
                  <span className="block font-medium">{TERM_LABELS[Number(value)] || `${value} Months`}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(monthly * Number(value))}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/40 bg-foreground/[0.03] p-5">
            <h2 className="font-semibold">Operating System / Platform</h2>
            <div className="mt-4">
              <Popover open={osOpen} onOpenChange={setOsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={osOpen}
                    aria-label="Select operating system or platform"
                    className="h-auto w-full justify-between border-border/40 bg-background px-3 py-3 text-left font-normal"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <OsIcon option={selectedOs} className="h-7 w-7" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{selectedOs?.name || "Select operating system or platform"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{selectedOs?.description || selectedOs?.familyLabel || "Search by OS, version, or platform"}</span>
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search OS or platform..." />
                    <CommandList className="max-h-[360px]">
                      <CommandEmpty>No operating system found.</CommandEmpty>
                      {groups.map((group) => (
                        <CommandGroup key={group.label} heading={group.label}>
                          {group.items.map((os) => (
                            <CommandItem
                              key={os.id}
                              value={`${os.name} ${os.version || ""} ${os.familyLabel} ${os.slug}`}
                              onSelect={() => {
                                setOsOptionId(os.id)
                                setOsOpen(false)
                              }}
                              className="items-start gap-3 py-3"
                            >
                              <OsIcon option={os} className="mt-0.5 h-7 w-7" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{os.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">{os.description || os.familyLabel}</span>
                              </span>
                              <Check className={cn("mt-1 h-4 w-4 shrink-0", osOptionId === os.id ? "opacity-100" : "opacity-0")} />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </section>

          <section className="rounded-lg border border-border/40 bg-foreground/[0.03] p-5">
            <h2 className="font-semibold">Access / Installation Notes</h2>
            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="hostname">Hostname</Label>
                <Input id="hostname" value={hostname} onChange={(event) => setHostname(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Installation notes / special request</Label>
                <Textarea id="notes" value={installationNotes} onChange={(event) => setInstallationNotes(event.target.value)} rows={4} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ssh">SSH key optional</Label>
                <Textarea id="ssh" value={sshPublicKey} onChange={(event) => setSshPublicKey(event.target.value)} rows={3} />
              </div>
              <label className="flex items-center justify-between rounded-md border border-border/40 p-3 text-sm">
                <span>IPMI/iDRAC access required?</span>
                <Switch checked={ipmiRequired} onCheckedChange={setIpmiRequired} />
              </label>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-border/40 bg-background/95 p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-accent" />
              <h2 className="font-semibold">Confirm Order</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <Row label="Server" value={product.name} />
              <Row label="Platform" value={selectedOs?.name || "-"} />
              <Row label="Term" value={TERM_LABELS[term] || `${term} Months`} />
              <Row label="Monthly" value={formatPrice(monthly)} />
              {product.dedicatedSettings.setupFee > 0 ? <Row label="Setup fee" value={formatPrice(product.dedicatedSettings.setupFee)} /> : null}
              {windowsSetupFee > 0 ? <Row label="Windows setup" value={formatPrice(windowsSetupFee)} /> : null}
              {windowsLicenseFee > 0 ? <Row label="Windows license" value={formatPrice(windowsLicenseFee)} /> : null}
              <Row label="Subtotal" value={formatPrice(subtotal)} />
              <Row label="GST" value={formatPrice(taxAmount)} />
              <div className="border-t border-border/40 pt-3">
                <Row label="Pay today" value={formatPrice(total)} strong />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Input placeholder="Coupon code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
              <button type="button" onClick={() => setPaymentMethod("gateway")} className={`w-full rounded-md border p-3 text-left text-sm ${paymentMethod === "gateway" ? "selected-item" : "border-border/40 hover:bg-[rgba(255,255,255,0.04)]"}`}>Pay by UPI/Card</button>
              <button type="button" onClick={() => canUseWallet && setPaymentMethod("wallet")} className={`w-full rounded-md border p-3 text-left text-sm ${paymentMethod === "wallet" ? "selected-item" : "border-border/40 hover:bg-[rgba(255,255,255,0.04)]"} ${!canUseWallet ? "opacity-60" : ""}`}>Pay from Wallet <span className="block text-xs text-muted-foreground">Balance {formatPrice(walletBalance)}</span></button>
            </div>
            <Button type="submit" disabled={submitting || !osOptionId} className="mt-5 w-full gap-1.5">
              {submitting ? "Initializing payment..." : "Proceed to Payment"}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="mt-4 flex gap-2 text-xs text-muted-foreground">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your dedicated server countdown starts after payment confirmation.</span>
            </div>
            <div className="mt-4 flex gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Final credentials are delivered by {brandName} engineers after installation.</span>
            </div>
            <Button asChild variant="ghost" className="mt-3 w-full gap-1.5">
              <a href="/support?topic=dedicated-sales"><MessageCircle className="h-4 w-4" />Support</a>
            </Button>
          </div>
        </aside>
      </form>
    </>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-semibold" : ""}`}><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>
}

function OsIcon({ option, className }: { option?: DedicatedOsOption | null; className?: string }) {
  if (option?.iconUrl) {
    return <Image src={option.iconUrl} width={28} height={28} alt="" className={cn("shrink-0 rounded-sm object-contain", className)} />
  }

  return <ShieldCheck className={cn("shrink-0 text-muted-foreground", className)} />
}
