"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { parseJsonResponse, readJsonResponse } from "@/lib/client/safe-json"

type SettingsState = {
  general: Record<string, any>
  payment: Record<string, any>
  security: Record<string, any>
  platform: Record<string, any>
  appearance: Record<string, any>
}

const categoryMap: Record<keyof SettingsState, string> = {
  general: "general_settings",
  payment: "payment_settings",
  security: "security_settings",
  platform: "platform_settings",
  appearance: "appearance_settings",
}

const settingTabs = new Set(["company", "security", "payments", "preview"])

const defaults: SettingsState = {
  general: {
    companyName: "",
    legalCompanyName: "",
    websiteName: "",
    brandName: "",
    tagline: "",
    registrationNumber: "",
    gstNumber: "",
    vatNumber: "",
    companyEmail: "",
    supportEmail: "",
    billingEmail: "",
    abuseEmail: "",
    salesEmail: "",
    companyPhone: "",
    supportPhone: "",
    whatsappNumber: "",
    telegramUsername: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
    footerDescription: "",
    footerCopyrightText: "",
    publicContactBox: "",
    facebookUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    telegramUrl: "",
    whatsappLink: "",
    discordUrl: "",
    youtubeUrl: "",
    metaTitle: "",
    metaDescription: "",
    metaKeywords: "",
    openGraphImageUrl: "",
    googleAnalyticsId: "",
    termsUrl: "",
    privacyUrl: "",
    refundPolicyUrl: "",
    abusePolicyUrl: "",
    senderName: "",
    senderEmail: "",
  },
  payment: {
    defaultCurrency: "INR",
    taxMode: "exclusive",
    invoicePrefix: "ZWS",
    invoiceFooterText: "",
  },
  security: {
    sessionTimeoutMinutes: 43200,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    otpExpiryMinutes: 5,
    whatsappOtpEnabled: true,
    allowedAdminRoles: ["super_admin", "admin", "support_agent", "seo_agent"],
  },
  platform: {
    appName: "",
    brandName: "",
    allowRegistration: true,
  },
  appearance: {
    logoUrl: "",
    faviconUrl: "",
    footerLogoUrl: "",
    invoiceLogoUrl: "",
    openGraphImageUrl: "",
    primaryColor: "#00D4FF",
    secondaryColor: "#0f172a",
    accentColor: "#00D4FF",
    successColor: "#22c55e",
    dangerColor: "#ef4444",
    warningColor: "#f59e0b",
  },
}

function normalize(input: any): SettingsState {
  return {
    general: { ...defaults.general, ...(input?.general || {}) },
    payment: { ...defaults.payment, ...(input?.payment || {}) },
    security: { ...defaults.security, ...(input?.security || {}) },
    platform: { ...defaults.platform, ...(input?.platform || {}) },
    appearance: { ...defaults.appearance, ...(input?.appearance || {}) },
  }
}

function publicAddress(general: Record<string, any>) {
  return [
    general.addressLine1,
    general.addressLine2,
    general.city,
    general.state,
    general.zipCode,
    general.country,
  ].map((item) => String(item || "").trim()).filter(Boolean).join(", ")
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [active, setActive] = useState("company")
  const [saving, setSaving] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "auth") {
      router.replace("/admin/settings?tab=security")
      setActive("security")
    } else if (tab === "general" || tab === "seo" || tab === "email") {
      router.replace("/admin/settings", { scroll: false })
      setActive("company")
    } else if (tab && settingTabs.has(tab)) {
      setActive(tab)
    } else if (tab) {
      router.replace("/admin/settings", { scroll: false })
      setActive("company")
    } else {
      setActive("company")
    }
  }, [router, searchParams])

  useEffect(() => {
    fetch("/api/admin/settings", { credentials: "include" })
      .then(async (response) => {
        const data = await parseJsonResponse(response)
        if (!response.ok) throw new Error(data?.error || "Failed to load settings")
        setSettings(normalize(data))
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load settings"))
  }, [])

  const canSave = useMemo(() => Boolean(settings), [settings])

  function update<K extends keyof SettingsState>(category: K, key: string, value: any) {
    setSettings((current) => current ? { ...current, [category]: { ...current[category], [key]: value } } : current)
  }

  async function save(category: keyof SettingsState) {
    if (!settings) return
    setSaving(category)
    try {
      const response = await fetch(`/api/admin/settings/${categoryMap[category]}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings[category]),
      })
      const body = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(body?.error || "Failed to save settings")
      setSettings(normalize({ ...settings, [category]: body.value || settings[category] }))
      if (body?.runtimeConfig && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zws-runtime-config", { detail: body.runtimeConfig }))
      }
      if (category === "platform") router.refresh()
      return body
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings")
      throw error
    } finally {
      setSaving(null)
    }
  }

  async function saveCards(categories: (keyof SettingsState)[], message = "Settings saved") {
    if (!settings) return
    setSaving("company")
    try {
      for (const category of categories) await save(category)
      toast.success(message)
      router.refresh()
    } catch {
      return
    } finally {
      setSaving(null)
    }
  }

  const companySaveButton = (categories: (keyof SettingsState)[]) => (
    <SaveButton disabled={!canSave || saving === "company"} saving={saving === "company"} onClick={() => saveCards(categories)} />
  )

  async function uploadAsset(target: "logo" | "favicon" | "footer-logo" | "invoice-logo" | "open-graph", file?: File) {
    if (!file || !settings) return
    const form = new FormData()
    form.set("target", target)
    form.set("file", file)
    const response = await fetch("/api/admin/settings/upload", { method: "POST", body: form })
    const body = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(body?.error || "Upload failed")
    const keyByTarget = {
      logo: "logoUrl",
      favicon: "faviconUrl",
      "footer-logo": "footerLogoUrl",
      "invoice-logo": "invoiceLogoUrl",
      "open-graph": "openGraphImageUrl",
    } as const
    update("appearance", keyByTarget[target], body.url)
    if (target === "open-graph") update("general", "openGraphImageUrl", body.url)
    toast.success("Branding asset uploaded")
  }

  if (!settings) return <div className="p-6 text-muted-foreground">Loading settings...</div>

  const brandName = settings.platform.brandName || settings.general.brandName || settings.general.companyName || "Company"
  const logo = settings.appearance.logoUrl || settings.general.logoUrl
  const footerLogo = settings.appearance.footerLogoUrl || logo
  const invoiceLogo = settings.appearance.invoiceLogoUrl || logo
  const ogImage = settings.appearance.openGraphImageUrl || settings.general.openGraphImageUrl || logo
  const address = settings.general.companyAddress || publicAddress(settings.general)

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage global company identity, public contact data, branding, SEO, invoices, and legal links.</p>
      </div>

      <Tabs value={active} onValueChange={(value) => {
        setActive(value)
        router.replace(value === "company" ? "/admin/settings" : `/admin/settings?tab=${encodeURIComponent(value)}`, { scroll: false })
      }} className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
        <TabsList className="hide-scrollbar grid h-auto w-full min-w-0 max-w-full grid-cols-2 overflow-x-auto md:grid-cols-4">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="preview">Preview Public Data</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">All values save to the database and feed public pages, invoices, emails, and runtime brand APIs.</p>
            <Button disabled={!canSave || saving === "company"} onClick={() => saveCards(["platform", "general", "appearance", "payment"], "All settings saved")} className="gap-2">
              <Save className="h-4 w-4" />{saving === "company" ? "Saving" : "Save all settings"}
            </Button>
          </div>

          <SettingsCard title="Company Information" description="Core public and legal identity." footer={companySaveButton(["platform", "general"])}>
            <Field label="Company Name"><Input value={settings.general.companyName || ""} onChange={(e) => { update("general", "companyName", e.target.value); update("platform", "brandName", e.target.value); update("general", "brandName", e.target.value) }} /></Field>
            <Field label="Legal Company Name"><Input value={settings.general.legalCompanyName || ""} onChange={(e) => update("general", "legalCompanyName", e.target.value)} /></Field>
            <Field label="Website Name"><Input value={settings.general.websiteName || settings.platform.appName || ""} onChange={(e) => { update("general", "websiteName", e.target.value); update("platform", "appName", e.target.value) }} /></Field>
            <Field label="Tagline"><Input value={settings.general.tagline || ""} onChange={(e) => update("general", "tagline", e.target.value)} /></Field>
            <Field label="Registration Number"><Input value={settings.general.registrationNumber || ""} onChange={(e) => update("general", "registrationNumber", e.target.value)} /></Field>
            <Field label="GST/VAT Number"><Input value={settings.general.gstNumber || settings.general.vatNumber || ""} onChange={(e) => { update("general", "gstNumber", e.target.value); update("general", "vatNumber", e.target.value) }} /></Field>
          </SettingsCard>

          <SettingsCard title="Contact Information" description="Public support, billing, abuse, phone, WhatsApp, and Telegram details." footer={companySaveButton(["general"])}>
            <Field label="Support Email"><Input type="email" value={settings.general.supportEmail || ""} onChange={(e) => update("general", "supportEmail", e.target.value)} /></Field>
            <Field label="Billing Email"><Input type="email" value={settings.general.billingEmail || ""} onChange={(e) => update("general", "billingEmail", e.target.value)} /></Field>
            <Field label="Abuse Email"><Input type="email" value={settings.general.abuseEmail || ""} onChange={(e) => update("general", "abuseEmail", e.target.value)} /></Field>
            <Field label="Company Email"><Input type="email" value={settings.general.companyEmail || ""} onChange={(e) => update("general", "companyEmail", e.target.value)} /></Field>
            <Field label="Support Phone"><Input value={settings.general.supportPhone || settings.general.companyPhone || ""} onChange={(e) => { update("general", "supportPhone", e.target.value); update("general", "companyPhone", e.target.value) }} /></Field>
            <Field label="WhatsApp Number"><Input value={settings.general.whatsappNumber || ""} onChange={(e) => update("general", "whatsappNumber", e.target.value)} /></Field>
            <Field label="Telegram Username"><Input value={settings.general.telegramUsername || ""} onChange={(e) => update("general", "telegramUsername", e.target.value)} placeholder="support_team" /></Field>
            <Field label="Sales Email"><Input type="email" value={settings.general.salesEmail || ""} onChange={(e) => update("general", "salesEmail", e.target.value)} /></Field>
          </SettingsCard>

          <SettingsCard title="Address" description="Structured address for public pages and invoices." footer={companySaveButton(["general"])}>
            <Field label="Address Line 1"><Input value={settings.general.addressLine1 || ""} onChange={(e) => update("general", "addressLine1", e.target.value)} /></Field>
            <Field label="Address Line 2"><Input value={settings.general.addressLine2 || ""} onChange={(e) => update("general", "addressLine2", e.target.value)} /></Field>
            <Field label="City"><Input value={settings.general.city || ""} onChange={(e) => update("general", "city", e.target.value)} /></Field>
            <Field label="State"><Input value={settings.general.state || ""} onChange={(e) => update("general", "state", e.target.value)} /></Field>
            <Field label="ZIP/Pincode"><Input value={settings.general.zipCode || ""} onChange={(e) => update("general", "zipCode", e.target.value)} /></Field>
            <Field label="Country"><Input value={settings.general.country || ""} onChange={(e) => update("general", "country", e.target.value)} /></Field>
          </SettingsCard>

          <SettingsCard title="Branding" description="Public, footer, invoice, favicon, and preview images." footer={companySaveButton(["appearance"])}>
            <AssetField label="Logo Upload" value={settings.appearance.logoUrl || ""} onChange={(value) => update("appearance", "logoUrl", value)} onFile={(file) => uploadAsset("logo", file)} />
            <AssetField label="Favicon Upload" value={settings.appearance.faviconUrl || ""} onChange={(value) => update("appearance", "faviconUrl", value)} onFile={(file) => uploadAsset("favicon", file)} />
            <AssetField label="Footer Logo" value={settings.appearance.footerLogoUrl || ""} onChange={(value) => update("appearance", "footerLogoUrl", value)} onFile={(file) => uploadAsset("footer-logo", file)} />
            <AssetField label="Invoice Logo" value={settings.appearance.invoiceLogoUrl || ""} onChange={(value) => update("appearance", "invoiceLogoUrl", value)} onFile={(file) => uploadAsset("invoice-logo", file)} />
            <ColorField label="Button (Primary) Color" value={settings.appearance.primaryColor || "#00D4FF"} onChange={(value) => update("appearance", "primaryColor", value)} />
            <ColorField label="Accent (Highlight) Color" value={settings.appearance.accentColor || "#00D4FF"} onChange={(value) => update("appearance", "accentColor", value)} />
          </SettingsCard>

          <SettingsCard title="SEO & Metadata" description="Default browser title, search text, OpenGraph image, and analytics ID." footer={companySaveButton(["general", "appearance"])}>
            <Field label="Meta Title"><Input value={settings.general.metaTitle || settings.general.defaultMetaTitle || ""} onChange={(e) => { update("general", "metaTitle", e.target.value); update("general", "defaultMetaTitle", e.target.value) }} /></Field>
            <Field label="Meta Keywords"><Input value={settings.general.metaKeywords || ""} onChange={(e) => update("general", "metaKeywords", e.target.value)} placeholder="cloud hosting, VPS, dedicated servers" /></Field>
            <div className="space-y-2 md:col-span-2"><Label>Meta Description</Label><Textarea value={settings.general.metaDescription || settings.general.defaultMetaDescription || ""} onChange={(e) => { update("general", "metaDescription", e.target.value); update("general", "defaultMetaDescription", e.target.value) }} /></div>
            <AssetField label="OpenGraph Image" value={settings.appearance.openGraphImageUrl || settings.general.openGraphImageUrl || ""} onChange={(value) => { update("appearance", "openGraphImageUrl", value); update("general", "openGraphImageUrl", value) }} onFile={(file) => uploadAsset("open-graph", file)} />
            <Field label="Google Analytics ID"><Input value={settings.general.googleAnalyticsId || ""} onChange={(e) => update("general", "googleAnalyticsId", e.target.value)} placeholder="G-XXXXXXXXXX" /></Field>
          </SettingsCard>

          <SettingsCard title="Public Footer" description="Footer text, contact box, and copyright copy." footer={companySaveButton(["general"])}>
            <div className="space-y-2 md:col-span-2"><Label>Footer Description</Label><Textarea value={settings.general.footerDescription || ""} onChange={(e) => update("general", "footerDescription", e.target.value)} /></div>
            <Field label="Footer Copyright Text"><Input value={settings.general.footerCopyrightText || ""} onChange={(e) => update("general", "footerCopyrightText", e.target.value)} /></Field>
            <div className="space-y-2 md:col-span-2"><Label>Public Contact Box</Label><Textarea value={settings.general.publicContactBox || ""} onChange={(e) => update("general", "publicContactBox", e.target.value)} /></div>
          </SettingsCard>

          <SettingsCard title="Social Media" description="Social and community links shown publicly." footer={companySaveButton(["general"])}>
            <Field label="Facebook"><Input value={settings.general.facebookUrl || ""} onChange={(e) => update("general", "facebookUrl", e.target.value)} /></Field>
            <Field label="Instagram"><Input value={settings.general.instagramUrl || ""} onChange={(e) => update("general", "instagramUrl", e.target.value)} /></Field>
            <Field label="X/Twitter"><Input value={settings.general.twitterUrl || ""} onChange={(e) => update("general", "twitterUrl", e.target.value)} /></Field>
            <Field label="Telegram"><Input value={settings.general.telegramUrl || ""} onChange={(e) => update("general", "telegramUrl", e.target.value)} /></Field>
            <Field label="WhatsApp Link"><Input value={settings.general.whatsappLink || ""} onChange={(e) => update("general", "whatsappLink", e.target.value)} /></Field>
            <Field label="Discord"><Input value={settings.general.discordUrl || ""} onChange={(e) => update("general", "discordUrl", e.target.value)} /></Field>
            <Field label="YouTube"><Input value={settings.general.youtubeUrl || ""} onChange={(e) => update("general", "youtubeUrl", e.target.value)} /></Field>
          </SettingsCard>

          <SettingsCard title="Billing & Invoice Identity" description="Invoice prefix, footer text, logo, and billing identity." footer={companySaveButton(["payment", "general", "appearance"])}>
            <Field label="Invoice Prefix"><Input value={settings.payment.invoicePrefix || "ZWS"} onChange={(e) => update("payment", "invoicePrefix", e.target.value)} /></Field>
            <Field label="Billing Email"><Input type="email" value={settings.general.billingEmail || ""} onChange={(e) => update("general", "billingEmail", e.target.value)} /></Field>
            <AssetField label="Invoice Logo" value={settings.appearance.invoiceLogoUrl || ""} onChange={(value) => update("appearance", "invoiceLogoUrl", value)} onFile={(file) => uploadAsset("invoice-logo", file)} />
            <div className="space-y-2 md:col-span-2"><Label>Invoice Footer Text</Label><Textarea value={settings.payment.invoiceFooterText || ""} onChange={(e) => update("payment", "invoiceFooterText", e.target.value)} /></div>
          </SettingsCard>

          <SettingsCard title="Legal Information" description="Policy URLs used by footer, legal surfaces, and public contact flows." footer={companySaveButton(["general"])}>
            <Field label="Terms URL"><Input value={settings.general.termsUrl || settings.general.tosUrl || ""} onChange={(e) => { update("general", "termsUrl", e.target.value); update("general", "tosUrl", e.target.value) }} /></Field>
            <Field label="Privacy URL"><Input value={settings.general.privacyUrl || ""} onChange={(e) => update("general", "privacyUrl", e.target.value)} /></Field>
            <Field label="Refund Policy URL"><Input value={settings.general.refundPolicyUrl || settings.general.refundUrl || ""} onChange={(e) => { update("general", "refundPolicyUrl", e.target.value); update("general", "refundUrl", e.target.value) }} /></Field>
            <Field label="Abuse Policy URL"><Input value={settings.general.abusePolicyUrl || ""} onChange={(e) => update("general", "abusePolicyUrl", e.target.value)} /></Field>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="preview">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Preview Public Data</CardTitle>
              <CardDescription>This is the current editable payload before or after saving.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <PreviewBlock title="Company Name" value={brandName} />
              <PreviewBlock title="Footer" value={settings.general.footerCopyrightText || `Copyright ${new Date().getFullYear()} ${brandName}`} description={settings.general.footerDescription} />
              <PreviewBlock title="Public Email" value={settings.general.supportEmail || settings.general.companyEmail || "Not set"} />
              <PreviewBlock title="WhatsApp" value={settings.general.whatsappNumber || settings.general.whatsappLink || "Not set"} />
              <PreviewBlock title="Address" value={address || "Not set"} />
              <div className="rounded-lg border border-border/40 bg-background/35 p-4">
                <p className="text-sm font-medium">Branding preview</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <ImagePreview label="Navbar" src={logo} />
                  <ImagePreview label="Footer" src={footerLogo} />
                  <ImagePreview label="Invoice" src={invoiceLogo} />
                </div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/35 p-4 lg:col-span-2">
                <p className="text-sm font-medium">SEO preview</p>
                <div className="mt-3 rounded-lg border border-border/40 bg-background p-4">
                  <p className="text-base font-semibold text-accent">{settings.general.metaTitle || `Cloud Compute Instances India | ${brandName}`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{settings.general.metaDescription || "No meta description set."}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{settings.general.metaKeywords || "No meta keywords set."}</p>
                  {ogImage ? <Image src={ogImage} alt="" width={320} height={144} unoptimized className="mt-4 max-h-36 rounded-md border border-border/40 object-contain" /> : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <div className="space-y-4">
            <SettingsCard title="Security" description="OTP, WhatsApp verification, and session controls." footer={<SaveButton disabled={!canSave || saving === "security"} saving={saving === "security"} onClick={() => save("security").then(() => toast.success("Settings saved"))} />}>
              <SwitchField label="WhatsApp OTP enabled" checked={Boolean(settings.security.whatsappOtpEnabled ?? true)} onCheckedChange={(value) => update("security", "whatsappOtpEnabled", value)} />
              <Field label="OTP expiry minutes"><Input type="number" value={String(settings.security.otpExpiryMinutes ?? 5)} onChange={(e) => update("security", "otpExpiryMinutes", Number(e.target.value || 5))} /></Field>
              <Field label="Session timeout minutes"><Input type="number" value={String(settings.security.sessionTimeoutMinutes || 60)} onChange={(e) => update("security", "sessionTimeoutMinutes", Number(e.target.value || 60))} /></Field>
              <Field label="Maximum login attempts"><Input type="number" value={String(settings.security.maxLoginAttempts || 5)} onChange={(e) => update("security", "maxLoginAttempts", Number(e.target.value || 5))} /></Field>
              <Field label="Temporary lockout minutes"><Input type="number" value={String(settings.security.lockoutDurationMinutes || 15)} onChange={(e) => update("security", "lockoutDurationMinutes", Number(e.target.value || 15))} /></Field>
            </SettingsCard>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <SettingsCard title="Payments" description="Invoice defaults and gateway entry points." footer={<SaveButton disabled={!canSave || saving === "payment"} saving={saving === "payment"} onClick={() => save("payment").then(() => toast.success("Settings saved"))} />}>
            <Field label="Default currency"><Input value={settings.payment.defaultCurrency || "INR"} onChange={(e) => update("payment", "defaultCurrency", e.target.value.toUpperCase())} /></Field>
            <div className="space-y-2">
              <Label>Tax mode</Label>
              <Select value={settings.payment.taxMode || "exclusive"} onValueChange={(value) => update("payment", "taxMode", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="exclusive">Exclusive</SelectItem><SelectItem value="inclusive">Inclusive</SelectItem><SelectItem value="none">No tax</SelectItem></SelectContent>
              </Select>
            </div>
            <Field label="Invoice prefix"><Input value={settings.payment.invoicePrefix || "ZWS"} onChange={(e) => update("payment", "invoicePrefix", e.target.value)} /></Field>
            <div className="rounded-lg border border-border/40 bg-background/35 p-3 md:col-span-2">
              <p className="text-sm font-medium">Payment gateways</p>
              <p className="mt-1 text-sm text-muted-foreground">Add, edit, test, and choose primary or fallback gateways from the dedicated page.</p>
              <Button asChild className="mt-3"><Link href="/admin/payments/gateways">Open Payment Gateways</Link></Button>
            </div>
          </SettingsCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SettingsCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="grid min-w-0 gap-4 md:grid-cols-2">{children}</CardContent>
      {footer ? <CardContent>{footer}</CardContent> : null}
    </Card>
  )
}

function SaveButton({ disabled, saving, onClick }: { disabled: boolean; saving: boolean; onClick: () => void }) {
  return <Button disabled={disabled || saving} onClick={onClick} className="gap-2"><Save className="h-4 w-4" />{saving ? "Saving" : "Save changes"}</Button>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function AssetField({ label, value, onChange, onFile }: { label: string; value: string; onChange: (value: string) => void; onFile: (file?: File) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid gap-2">
        {value ? <Image src={value} alt="" width={128} height={64} unoptimized className="h-16 w-32 rounded-md border border-border/40 bg-background object-contain p-2" /> : <div className="flex h-16 w-32 items-center justify-center rounded-md border border-dashed border-border/60 text-xs text-muted-foreground">No image</div>}
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="/uploads/branding/logo.png" />
        <Input type="file" accept="image/*,.ico" onChange={(event) => onFile(event.target.files?.[0])} />
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-14 p-1" />
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="#14b8a6" />
      </div>
    </Field>
  )
}

function SwitchField({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>
}

function PreviewBlock({ title, value, description }: { title: string; value: string; description?: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/35 p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 break-words text-sm text-foreground">{value}</p>
      {description ? <p className="mt-2 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function ImagePreview({ label, src }: { label: string; src?: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background p-3">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      {src ? <Image src={src} alt="" width={160} height={56} unoptimized className="h-14 w-full object-contain" /> : <div className="flex h-14 items-center justify-center text-xs text-muted-foreground">No image</div>}
    </div>
  )
}
