"use client"

import { adminApiErrorMessage, adminApiJson, isAdminAuthError } from "@/lib/client/admin-api"
import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { generateProductFeatures, generateProductSpecs } from "@/lib/product-features"

type Category = { id: string; title: string; parentId: string | null }
type RegionRow = { name: string; code: string; enabled: boolean }
type SpecRow = { label: string; value: string }
type AdvancedField = { value: string; warning?: string }
type Mode = "create" | "edit"
type StoragePoolOption = { id: string; nodeName: string; displayName: string; storageId: string; storageTypeLabel: string; enabled: boolean; isUpgradeOnly: boolean; missingFromProxmox: boolean }
type IpPoolOption = { id: string; name: string; startIp: string; endIp: string; cidr: number; type: string; isActive: boolean }
type ProxmoxNodeOption = { id: string; name: string; nodeName: string; status?: string | null; isActive?: boolean }
type ProductIpAssignment = { poolId: string; isDefault: boolean; allowPremium: boolean }
type SaveStatus = "idle" | "saving" | "saved" | "failed" | "mfa_required"

const BILLING_TERMS = [1, 3, 6, 12, 24, 36]

const baseForm = {
  slug: "",
  name: "",
  shortDescription: "",
  description: "",
  type: "fixed_vps",
  ctaMode: "purchase_now",
  ctaLabel: "Deploy",
  seoTitle: "",
  seoDescription: "",
  whatsappEnabled: false,
  categoryId: "",
  subcategoryId: "",
  cpuCores: "2",
  ramGb: "4",
  storageGb: "80",
  storageType: "nvme",
  defaultNodeId: "",
  storagePolicyType: "NODE_DEFAULT",
  requiredStorageType: "",
  requiredStoragePoolId: "",
  allowStorageFallback: true,
  premiumIpEnabled: false,
  autoProvision: "inherit",
  consoleEnabled: true,
  bandwidthTb: "1",
  backupEnabled: false,
  backupPrice: "0",
  backupStorageGb: "0",
  snapshotEnabled: false,
  snapshotPrice: "0",
  snapshotIncludedCount: "0",
  bandwidthEnabled: true,
  bandwidthPrice: "0",
  bandwidthLimitTb: "",
  bandwidthOveragePrice: "0",
  extraIpv4Price: "0",
  price1m: "999",
  price3m: "",
  price6m: "",
  price12m: "",
  price24m: "",
  price36m: "",
  status: "active",
  isActive: true,
  isFeatured: false,
  dedicatedDeliverySlaHours: "72",
  dedicatedBandwidthLabel: "",
  dedicatedLocation: "India",
  dedicatedSetupFee: "",
  dedicatedPurchaseEnabled: true,
  dedicatedWhatsappEnabled: true,
  dedicatedAllowCustomOsRequest: true,
  geoVisibilityMode: "global",
  geoAllowedCountriesText: "",
  geoBlockedCountriesText: "",
}

type ProductFormState = typeof baseForm & {
  billingTerms: number[]
  regions: RegionRow[]
  badgesText: string
  featuresText: string
  specs: SpecRow[]
  seoKeywordsText: string
  optionGroups: AdvancedField
  serviceAttributes: AdvancedField
}

type MonthlyOverrideValues = Pick<ProductFormState, "price3m" | "price6m" | "price12m" | "price24m" | "price36m">
type MonthlyOverrideKey = keyof MonthlyOverrideValues

const MONTHLY_OVERRIDE_KEYS: MonthlyOverrideKey[] = ["price3m", "price6m", "price12m", "price24m", "price36m"]

const emptyForm: ProductFormState = {
  ...baseForm,
  billingTerms: [1, 3, 6, 12, 24, 36],
  regions: [],
  badgesText: "",
  featuresText: "",
  specs: [],
  seoKeywordsText: "",
  optionGroups: { value: "[]" },
  serviceAttributes: { value: "{}" },
}

export function ProductForm({ mode }: { mode: Mode }) {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState<ProductFormState>(emptyForm)
  const [storagePools, setStoragePools] = useState<StoragePoolOption[]>([])
  const [ipPools, setIpPools] = useState<IpPoolOption[]>([])
  const [nodes, setNodes] = useState<ProxmoxNodeOption[]>([])
  const [productIpAssignments, setProductIpAssignments] = useState<ProductIpAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [degradedWarnings, setDegradedWarnings] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [ipAssignmentsLoaded, setIpAssignmentsLoaded] = useState(mode !== "edit")
  const pendingStepUpAction = useRef<null | (() => Promise<unknown>)>(null)
  const [stepUp, setStepUp] = useState({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })
  const previousGeneratedFeaturesRef = useRef<string[]>([])
  const productId = String(params.id || "")
  const saving = saveStatus === "saving"

  const savedNoticeKey = useCallback((id = productId) => id ? `zws-admin-product-saved:${id}` : "", [productId])

  const rememberSavedNotice = useCallback((product: any) => {
    if (typeof window === "undefined") return
    const key = savedNoticeKey(String(product?.id || productId || ""))
    if (key) window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now() }))
  }, [productId, savedNoticeKey])

  const restoreRecentSavedNotice = useCallback((id = productId) => {
    if (typeof window === "undefined") return false
    const key = savedNoticeKey(id)
    if (!key) return false
    try {
      const notice = JSON.parse(window.sessionStorage.getItem(key) || "{}")
      if (Date.now() - Number(notice?.at || 0) <= 30_000) return true
      window.sessionStorage.removeItem(key)
    } catch {
      window.sessionStorage.removeItem(key)
    }
    return false
  }, [productId, savedNoticeKey])

  const loadForm = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setDegradedWarnings([])
    try {
      if (mode === "edit") {
        const productData = await adminApiJson<{ product?: any }>(`/api/admin/products/${productId}`)
        if (!productData?.product) throw new Error("Product was not found or returned an empty response.")
        setForm(formFromProduct(productData.product))
        if (restoreRecentSavedNotice(String(productData.product.id || productId))) setSaveStatus("saved")
      } else {
        setForm(emptyForm)
        setIpAssignmentsLoaded(true)
      }

      const categoryData = await adminApiJson<{ categories?: Category[] }>("/api/admin/categories")
      setCategories(Array.isArray(categoryData.categories) ? categoryData.categories : [])

      const optionalResults = await Promise.allSettled([
        adminApiJson<{ pools?: IpPoolOption[] }>("/api/admin/ip-pools"),
        mode === "edit" ? adminApiJson<{ assignments?: any[] }>(`/api/admin/products/${productId}/ip-pools`) : Promise.resolve({ assignments: [] }),
        adminApiJson<{ pools?: StoragePoolOption[] }>("/api/admin/storage-pools"),
        adminApiJson<any>("/api/admin/proxmox-nodes"),
      ])

      const [ipPoolsResult, assignmentsResult, storagePoolsResult, nodesResult] = optionalResults
      const warnings: string[] = []

      if (ipPoolsResult.status === "fulfilled") {
        setIpPools(Array.isArray(ipPoolsResult.value.pools) ? ipPoolsResult.value.pools : [])
      } else if (!isAdminAuthError(ipPoolsResult.reason)) {
        warnings.push(adminApiErrorMessage(ipPoolsResult.reason, "IP pool controls are temporarily unavailable."))
      }

      if (assignmentsResult.status === "fulfilled") {
        setProductIpAssignments((assignmentsResult.value.assignments || []).map((row: any) => ({
          poolId: row.poolId,
          isDefault: Boolean(row.isDefault),
          allowPremium: Boolean(row.allowPremium),
        })))
        setIpAssignmentsLoaded(true)
      } else if (!isAdminAuthError(assignmentsResult.reason)) {
        setIpAssignmentsLoaded(false)
        warnings.push(adminApiErrorMessage(assignmentsResult.reason, "Product IP pool assignments are temporarily unavailable."))
      }

      if (storagePoolsResult.status === "fulfilled") {
        setStoragePools(Array.isArray(storagePoolsResult.value.pools) ? storagePoolsResult.value.pools : [])
      } else if (!isAdminAuthError(storagePoolsResult.reason)) {
        warnings.push(adminApiErrorMessage(storagePoolsResult.reason, "Storage pool choices are temporarily unavailable."))
      }

      if (nodesResult.status === "fulfilled") {
        const rawNodes = Array.isArray(nodesResult.value) ? nodesResult.value : Array.isArray(nodesResult.value.nodes) ? nodesResult.value.nodes : []
        setNodes(rawNodes.map((node: any) => ({
          id: String(node.id || ""),
          name: String(node.name || node.nodeName || "Node"),
          nodeName: String(node.nodeName || node.name || "node"),
          status: node.status || null,
          isActive: node.isActive !== false,
        })).filter((node: ProxmoxNodeOption) => node.id && node.isActive))
      } else if (!isAdminAuthError(nodesResult.reason)) {
        warnings.push(adminApiErrorMessage(nodesResult.reason, "Provision node choices are temporarily unavailable."))
      }

      setDegradedWarnings(warnings)
    } catch (error) {
      const message = adminApiErrorMessage(error, "Failed to load product form")
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [mode, productId, restoreRecentSavedNotice])

  useEffect(() => {
    void loadForm()
  }, [loadForm])

  const rootCategories = useMemo(() => categories.filter((category) => !category.parentId), [categories])
  const subcategories = useMemo(() => categories.filter((category) => category.parentId === form.categoryId), [categories, form.categoryId])

  useEffect(() => {
    if (loading) return
    setForm((current) => {
      const currentProductLike = productLikeFromForm(current)
      const nextGeneratedFeatures = generateProductFeatures(currentProductLike)
      const nextFeaturesText = mergeGeneratedFeatureText(
        current.featuresText,
        previousGeneratedFeaturesRef.current,
        nextGeneratedFeatures,
      )
      previousGeneratedFeaturesRef.current = nextGeneratedFeatures
      return nextFeaturesText === current.featuresText ? current : { ...current, featuresText: nextFeaturesText }
    })
  }, [
    loading,
    form.cpuCores,
    form.ramGb,
    form.storageGb,
    form.bandwidthTb,
    form.storageType,
    form.requiredStorageType,
    form.regions,
    form.specs,
  ])

  function update<Key extends keyof ProductFormState>(key: Key, value: ProductFormState[Key]) {
    if (saveStatus === "saved" || saveStatus === "failed") {
      setSaveStatus("idle")
      setSaveError(null)
    }
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateBaseMonthlyPrice(value: string) {
    setForm((current) => {
      const trimmed = value.trim()
      if (!trimmed) return { ...current, price1m: value }

      const basePrice = Number(trimmed)
      if (!Number.isFinite(basePrice)) {
        return { ...current, price1m: value }
      }

      const previousBasePrice = Number(String(current.price1m).trim())
      const previousAuto = Number.isFinite(previousBasePrice) ? calculateMonthlyOverrides(previousBasePrice) : null
      const nextAuto = calculateMonthlyOverrides(basePrice)
      const next: ProductFormState = { ...current, price1m: value }

      for (const key of MONTHLY_OVERRIDE_KEYS) {
        const currentValue = String(current[key] ?? "")
        if (!currentValue.trim() || (previousAuto && monthlyOverrideMatches(currentValue, previousAuto[key]))) {
          next[key] = nextAuto[key]
        }
      }

      return next
    })
  }

  function notifyProductSaved(product: any) {
    if (typeof window === "undefined") return
    const message = { type: "product:saved", productId: product?.id || productId, slug: product?.slug, at: Date.now() }
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("zws-admin-products")
      channel.postMessage(message)
      channel.close()
    }
    window.localStorage.setItem("zws-admin-products-sync", JSON.stringify(message))
  }

  async function startStepUp(action: () => Promise<unknown>) {
    pendingStepUpAction.current = action
    setSaveStatus("mfa_required")
    try {
      const data = await adminApiJson<any>("/api/auth/mfa/step-up/start", {
        method: "POST",
        body: "{}",
        redirectOnAuthError: false,
      })
      if (data.code === "mfa_not_required") {
        pendingStepUpAction.current = null
        await action()
        return
      }
      setStepUp({ open: true, busy: false, challengeToken: data.challengeToken, method: data.method, maskedTarget: data.maskedTarget || "", code: "" })
    } catch (error) {
      pendingStepUpAction.current = null
      const message = adminApiErrorMessage(error, "Unable to start MFA verification")
      setSaveStatus("failed")
      setSaveError(message)
      toast.error(message)
    }
  }

  async function verifyStepUp() {
    setStepUp((state) => ({ ...state, busy: true }))
    try {
      await adminApiJson<any>("/api/auth/mfa/step-up/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken: stepUp.challengeToken, method: stepUp.method, code: stepUp.code }),
        redirectOnAuthError: false,
      })
      const action = pendingStepUpAction.current
      pendingStepUpAction.current = null
      setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })
      toast.success("MFA verified")
      if (action) await action()
    } catch (error) {
      setStepUp((state) => ({ ...state, busy: false }))
      const message = adminApiErrorMessage(error, "MFA verification failed")
      setSaveStatus("failed")
      setSaveError(message)
      toast.error(message)
    }
  }

  async function handleStepUpResponse(error: unknown, retry: () => Promise<unknown>) {
    const code = String((error as any)?.code || (error as any)?.data?.code || "")
    if (code === "recent_mfa_required" || code === "mfa_required") {
      await startStepUp(retry)
      return true
    }
    return false
  }

  async function submit() {
    if (saving) return
    setSaveStatus("saving")
    setSaveError(null)
    let deferredToStepUp = false
    try {
      const optionGroups = parseAdvancedJson(form.optionGroups.value, [])
      const serviceAttributes = parseAdvancedJson(form.serviceAttributes.value, {})
      const category = rootCategories.find((item) => item.id === form.categoryId)
      const payload = {
        ...form,
        cpuCores: Number(form.cpuCores),
        ramGb: Number(form.ramGb),
        storageGb: Number(form.storageGb),
        bandwidthTb: Number(form.bandwidthTb),
        backupEnabled: Boolean(form.backupEnabled),
        backupPrice: Number(form.backupPrice || 0),
        backupStorageGb: Number(form.backupStorageGb || 0),
        snapshotEnabled: Boolean(form.snapshotEnabled),
        snapshotPrice: Number(form.snapshotPrice || 0),
        snapshotIncludedCount: Number(form.snapshotIncludedCount || 0),
        bandwidthEnabled: Boolean(form.bandwidthEnabled),
        bandwidthPrice: Number(form.bandwidthPrice || 0),
        bandwidthLimitTb: form.bandwidthLimitTb === "" ? null : Number(form.bandwidthLimitTb),
        bandwidthOveragePrice: Number(form.bandwidthOveragePrice || 0),
        extraIpv4Price: Number(form.extraIpv4Price || 0),
        price1m: Number(form.price1m || 0),
        price3m: form.price3m === "" ? null : Number(form.price3m),
        price6m: form.price6m === "" ? null : Number(form.price6m),
        price12m: form.price12m === "" ? null : Number(form.price12m),
        price24m: form.price24m === "" ? null : Number(form.price24m),
        price36m: form.price36m === "" ? null : Number(form.price36m),
        category: category?.title?.toLowerCase() || category?.id || "catalog",
        billingTerms: parseBillingTerms(form.billingTerms),
        regions: parseRegions(form.regions),
        specs: parseKeyValueRows(form.specs),
        optionGroups,
        serviceAttributes,
        features: parseLinesToJsonArray(form.featuresText),
        badges: parseCommaTagsToJsonArray(form.badgesText),
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        seoKeywords: parseCommaTagsToJsonArray(form.seoKeywordsText),
        whatsappEnabled: Boolean(form.whatsappEnabled),
        isActive: form.status === "active",
        disks: [{ type: form.storageType, sizeGb: Number(form.storageGb) }],
        storagePolicyType: form.storagePolicyType || "NODE_DEFAULT",
        requiredStorageType: form.requiredStorageType || null,
        requiredStoragePoolId: form.requiredStoragePoolId || null,
        defaultNodeId: form.defaultNodeId || null,
        defaultStoragePoolId: form.requiredStoragePoolId || null,
        allowStorageFallback: Boolean(form.allowStorageFallback),
        metadata: {
          autoProvision: form.autoProvision === "on" ? true : form.autoProvision === "off" ? false : "inherit",
          consoleEnabled: Boolean(form.consoleEnabled),
          dedicated: {
            deliverySlaHours: Number(form.dedicatedDeliverySlaHours || 72),
            bandwidthLabel: form.dedicatedBandwidthLabel || null,
            location: form.dedicatedLocation || "India",
            setupFee: form.dedicatedSetupFee === "" ? 0 : Number(form.dedicatedSetupFee),
            purchaseEnabled: Boolean(form.dedicatedPurchaseEnabled),
            whatsappEnabled: Boolean(form.dedicatedWhatsappEnabled),
            allowCustomOsRequest: Boolean(form.dedicatedAllowCustomOsRequest),
          },
          geoVisibility: {
            mode: form.geoVisibilityMode === "country_restricted" ? "country_restricted" : "global",
            allowedCountries: parseCountryCodes(form.geoAllowedCountriesText),
            blockedCountries: parseCountryCodes(form.geoBlockedCountriesText),
          },
        },
        ...(ipAssignmentsLoaded ? { ipAssignments: productIpAssignments } : {}),
      }
      const data = await adminApiJson<{ product?: any; assignments?: any[] }>(mode === "edit" ? `/api/admin/products/${productId}` : "/api/admin/products", {
        method: mode === "edit" ? "PUT" : "POST",
        body: JSON.stringify(payload),
        redirectOnAuthError: false,
      })
      const savedProductId = String(data?.product?.id || productId || "")
      if (data?.product) setForm(formFromProduct(data.product))
      if (Array.isArray(data?.assignments)) {
        setProductIpAssignments(data.assignments.map((row: any) => ({
          poolId: row.poolId,
          isDefault: Boolean(row.isDefault),
          allowPremium: Boolean(row.allowPremium),
        })))
        setIpAssignmentsLoaded(true)
      }
      rememberSavedNotice(data?.product)
      setSaveStatus("saved")
      toast.success(mode === "edit" ? "Product updated successfully" : "Product created")
      notifyProductSaved(data?.product)
      if (mode === "create" && savedProductId) router.replace(`/admin/products/${savedProductId}`)
    } catch (error) {
      if (await handleStepUpResponse(error, submit)) {
        deferredToStepUp = true
        return
      }
      const message = adminApiErrorMessage(error, "Invalid advanced settings")
      setSaveStatus("failed")
      setSaveError(message)
      toast.error(message)
    } finally {
      if (!deferredToStepUp) {
        setSaveStatus((current) => current === "saving" ? "idle" : current)
      }
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading product form...</p>

  if (loadError) {
    return (
      <Card className="glass border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            Product editor could not load
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={loadForm} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/admin/products")}>
              Back to products
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      {degradedWarnings.length ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {degradedWarnings[0]}
        </div>
      ) : null}
      {saveStatus === "failed" && saveError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to save: {saveError}
        </div>
      ) : null}
      {saveStatus === "saved" ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Saved successfully.
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{mode === "edit" ? "Edit Product" : "Add Product"}</h1>
            <Badge className={form.status === "draft" ? "border-gray-400/40 bg-gray-400/10 text-gray-200 hover:bg-gray-400/15" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"}>
              {form.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Manage catalog details, monthly pricing, and public deployment metadata.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/admin/products")}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={saving}>{saving ? "Saving..." : mode === "edit" ? "Save Product" : "Create Product"}</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Product Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
        <Field label="Name" value={form.name} onChange={(value) => update("name", value)} />
        <Field label="Slug" value={form.slug} onChange={(value) => update("slug", value)} />
        <Field label="Short Description" value={form.shortDescription} onChange={(value) => update("shortDescription", value)} />
        <SelectField label="Product Type" value={form.type} onChange={(value) => update("type", value)} options={[["fixed_vps", "Fixed Cloud Instance Plan"], ["configurable", "Configurable"], ["dedicated", "Dedicated / BMS"]]} />
        <SelectField label="CTA Mode" value={form.ctaMode} onChange={(value) => update("ctaMode", value)} options={[["purchase_now", "Purchase Now"], ["configure", "Configure"], ["contact_sales", "Contact Sales"]]} />
        <div className="space-y-2 md:col-span-2">
          <Label>Description</Label>
          <Textarea value={form.description} onChange={(event) => update("description", event.target.value)} />
        </div>
        <SelectField label="Main Category" value={form.categoryId} onChange={(value) => setForm((current) => ({ ...current, categoryId: value, subcategoryId: "" }))} options={[["", "Select category"], ...rootCategories.map((category) => [category.id, category.title] as [string, string])]} />
        <SelectField label="Subcategory" value={form.subcategoryId} onChange={(value) => update("subcategoryId", value)} options={[["", "None"], ...subcategories.map((category) => [category.id, category.title] as [string, string])]} />
        <Field label="CTA Label" value={form.ctaLabel} onChange={(value) => update("ctaLabel", value)} />
        <SelectField label="Storage Type" value={form.storageType} onChange={(value) => update("storageType", value)} options={[["nvme", "NVMe"], ["ssd", "SSD"]]} />
        {mode === "edit" ? <SelectField label="Status" value={form.status} onChange={(value) => update("status", value)} options={[["active", "Active"], ["draft", "Draft"]]} /> : null}
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <PriceField label="1 Month Price" value={form.price1m} onChange={updateBaseMonthlyPrice} />
              <PriceField label="3 Month Monthly Override" value={form.price3m} onChange={(value) => update("price3m", value)} />
              <PriceField label="6 Month Monthly Override" value={form.price6m} onChange={(value) => update("price6m", value)} />
              <PriceField label="12 Month Monthly Override" value={form.price12m} onChange={(value) => update("price12m", value)} />
              <PriceField label="24 Month Monthly Override" value={form.price24m} onChange={(value) => update("price24m", value)} />
              <PriceField label="36 Month Monthly Override" value={form.price36m} onChange={(value) => update("price36m", value)} />
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Add-on Pricing</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CheckField label="Backup Enabled" checked={form.backupEnabled} onChange={(checked) => update("backupEnabled", checked)} />
              <PriceField label="Backup Price" value={form.backupPrice} onChange={(value) => update("backupPrice", value)} />
              <Field label="Backup Storage (GB)" value={form.backupStorageGb} onChange={(value) => update("backupStorageGb", value)} />
              <CheckField label="Snapshot Enabled" checked={form.snapshotEnabled} onChange={(checked) => update("snapshotEnabled", checked)} />
              <PriceField label="Snapshot Price" value={form.snapshotPrice} onChange={(value) => update("snapshotPrice", value)} />
              <Field label="Included Snapshots" value={form.snapshotIncludedCount} onChange={(value) => update("snapshotIncludedCount", value)} />
              <CheckField label="Bandwidth Billing Enabled" checked={form.bandwidthEnabled} onChange={(checked) => update("bandwidthEnabled", checked)} />
              <PriceField label="Bandwidth Add-on Price" value={form.bandwidthPrice} onChange={(value) => update("bandwidthPrice", value)} />
              <Field label="Bandwidth Limit (TB)" value={form.bandwidthLimitTb} onChange={(value) => update("bandwidthLimitTb", value)} />
              <PriceField label="Bandwidth Overage Price" value={form.bandwidthOveragePrice} onChange={(value) => update("bandwidthOveragePrice", value)} />
              <PriceField label="Extra IPv4 Price" value={form.extraIpv4Price} onChange={(value) => update("extraIpv4Price", value)} />
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Deployment Summary</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Field label="vCPU" value={form.cpuCores} onChange={(value) => update("cpuCores", value)} />
              <Field label="RAM (GB)" value={form.ramGb} onChange={(value) => update("ramGb", value)} />
              <Field label="Storage (GB)" value={form.storageGb} onChange={(value) => update("storageGb", value)} />
              <Field label="Bandwidth (TB)" value={form.bandwidthTb} onChange={(value) => update("bandwidthTb", value)} />
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Deployment Controls</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">

        <div className="space-y-3 rounded-lg border border-border/40 p-4 md:col-span-2">
          <div>
            <h3 className="text-sm font-semibold">Storage Assignment</h3>
            <p className="text-xs text-muted-foreground">Choose how fixed-plan disks are placed during provisioning.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Storage Policy"
              value={form.storagePolicyType}
              onChange={(value) => update("storagePolicyType", value)}
              options={[["NODE_DEFAULT", "Use selected node default"], ["STORAGE_CLASS", "Require storage class"], ["EXACT_POOL", "Require exact storage pool"]]}
            />
            <SelectField
              label="Required Storage Class"
              value={form.requiredStorageType}
              onChange={(value) => update("requiredStorageType", value)}
              options={[["", "No class requirement"], ["SSD", "SSD"], ["NVME", "NVMe"], ["NVME2", "NVMe2"], ["NVME_GEN4", "NVMe Gen4"], ["HDD", "HDD"], ["LOCAL", "Local"], ["CUSTOM", "Custom"]]}
            />
            <SelectField
              label="Exact Storage Pool"
              value={form.requiredStoragePoolId}
              onChange={(value) => update("requiredStoragePoolId", value)}
              options={[["", "Use policy/default"], ...storagePools.map((pool) => [pool.id, `${pool.nodeName} / ${pool.displayName} (${pool.storageId})${pool.enabled ? "" : " - disabled"}${pool.missingFromProxmox ? " - missing" : ""}`] as [string, string])]}
            />
            <div className="flex items-end">
              <CheckField label="Allow storage fallback if policy pool is unavailable" checked={form.allowStorageFallback} onChange={(checked) => update("allowStorageFallback", checked)} />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/40 p-4 md:col-span-2">
          <div>
            <h3 className="text-sm font-semibold">Default Provision Node</h3>
            <p className="text-xs text-muted-foreground">Choose automatic placement or pin this product to a specific compute node.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Auto Provision"
              value={form.autoProvision}
              onChange={(value) => update("autoProvision", value)}
              options={[["inherit", "Use Global Setting"], ["on", "Always Auto Provision"], ["off", "Manual Review"]]}
            />
            <div className="flex items-end">
              <CheckField label="Allow client console for this product" checked={form.consoleEnabled} onChange={(checked) => update("consoleEnabled", checked)} />
            </div>
            <SelectField
              label="Node Selection"
              value={form.defaultNodeId ? "specific" : "auto"}
              onChange={(value) => {
                if (value === "auto") update("defaultNodeId", "")
                else if (!form.defaultNodeId && nodes[0]?.id) update("defaultNodeId", nodes[0].id)
              }}
              options={[["auto", "Auto Select"], ["specific", "Specific Node"]]}
            />
            {form.defaultNodeId ? (
              <SelectField
                label="Provision Node"
                value={form.defaultNodeId}
                onChange={(value) => update("defaultNodeId", value)}
                options={nodes.map((node) => [node.id, `${node.name} (${node.nodeName})${node.status ? ` - ${node.status}` : ""}`] as [string, string])}
              />
            ) : null}
          </div>
        </div>

        <ProductIpPoolControls
          pools={ipPools}
          premiumEnabled={form.premiumIpEnabled}
          onPremiumEnabledChange={(checked) => update("premiumIpEnabled", checked)}
          assignments={productIpAssignments}
          onAssignmentsChange={setProductIpAssignments}
        />

        <div className="space-y-3 rounded-lg border border-border/40 p-4 md:col-span-2">
          <div>
            <h3 className="text-sm font-semibold">Product Visibility</h3>
            <p className="text-xs text-muted-foreground">Backend-enforced country visibility for catalog and checkout.</p>
          </div>
          <SelectField label="Geo visibility" value={form.geoVisibilityMode} onChange={(value) => update("geoVisibilityMode", value)} options={[["global", "Global Product"], ["country_restricted", "Restrict by country"]]} />
          {form.geoVisibilityMode === "country_restricted" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Allowed countries" value={form.geoAllowedCountriesText} onChange={(value) => update("geoAllowedCountriesText", value)} placeholder="US, GB, IN" />
              <Field label="Blocked countries" value={form.geoBlockedCountriesText} onChange={(value) => update("geoBlockedCountriesText", value)} placeholder="AE, GB" />
            </div>
          ) : null}
        </div>

        <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
          <CheckField label="Featured product" checked={form.isFeatured} onChange={(checked) => update("isFeatured", checked)} />
          <CheckField label="Enable WhatsApp CTA" checked={form.whatsappEnabled} onChange={(checked) => update("whatsappEnabled", checked)} />
        </div>
            </CardContent>
          </Card>

        {form.type === "dedicated" ? (
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Dedicated Ordering</CardTitle></CardHeader>
            <CardContent>
          <div className="space-y-3 rounded-lg border border-border/40 p-4 md:col-span-2">
            <div>
              <h3 className="text-sm font-semibold">Dedicated Server Ordering</h3>
              <p className="text-xs text-muted-foreground">Controls the public Book Now flow, delivery SLA, and sales CTA behavior.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Delivery SLA hours" value={form.dedicatedDeliverySlaHours} onChange={(value) => update("dedicatedDeliverySlaHours", value)} />
              <Field label="Setup fee" value={form.dedicatedSetupFee} onChange={(value) => update("dedicatedSetupFee", value)} />
              <Field label="Bandwidth label" value={form.dedicatedBandwidthLabel} onChange={(value) => update("dedicatedBandwidthLabel", value)} placeholder="512 Mbps uplink" />
              <Field label="Location" value={form.dedicatedLocation} onChange={(value) => update("dedicatedLocation", value)} />
              <CheckField label="Enable purchase CTA" checked={form.dedicatedPurchaseEnabled} onChange={(checked) => update("dedicatedPurchaseEnabled", checked)} />
              <CheckField label="Enable WhatsApp sales CTA" checked={form.dedicatedWhatsappEnabled} onChange={(checked) => update("dedicatedWhatsappEnabled", checked)} />
              <CheckField label="Allow custom OS request" checked={form.dedicatedAllowCustomOsRequest} onChange={(checked) => update("dedicatedAllowCustomOsRequest", checked)} />
            </div>
          </div>
            </CardContent>
          </Card>
        ) : null}

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Catalog Content</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
        <BillingTermsField value={form.billingTerms} onChange={(value) => update("billingTerms", value)} />
        <div className="space-y-2">
          <Label>Badges</Label>
          <Input value={form.badgesText} onChange={(event) => update("badgesText", event.target.value)} placeholder="Enterprise, Featured, Popular" />
        </div>
        <RegionsField value={form.regions} onChange={(value) => update("regions", value)} />
        <SpecsField value={form.specs} onChange={(value) => update("specs", value)} />
        <div className="space-y-2 md:col-span-2">
          <Label>Features</Label>
          <Textarea value={form.featuresText} onChange={(event) => update("featuresText", event.target.value)} rows={6} placeholder={"16 vCPU Cores\n96 GB DDR4 RAM\n1.2 TB NVMe SSD"} />
        </div>

        <Field label="SEO Title" value={form.seoTitle} onChange={(value) => update("seoTitle", value)} />
        <div className="space-y-2">
          <Label>SEO Keywords</Label>
          <Input value={form.seoKeywordsText} onChange={(event) => update("seoKeywordsText", event.target.value)} placeholder="cloud instances, nvme, india" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>SEO Description</Label>
          <Textarea value={form.seoDescription} onChange={(event) => update("seoDescription", event.target.value)} rows={3} />
        </div>

        <AdvancedSettings form={form} update={update} />
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Product state</span>
                <Badge className={form.status === "draft" ? "border-gray-400/40 bg-gray-400/10 text-gray-200 hover:bg-gray-400/15" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"}>
                  {form.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Base monthly</span>
                <span className="font-semibold tabular-nums">INR {Number(form.price1m || 0).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Family</span>
                <span className="font-medium uppercase tracking-wide">{form.type.replace(/_/g, " ")}</span>
              </div>
            </CardContent>
          </Card>

        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/40 bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{form.name || "Untitled product"}</p>
            <p className="text-xs text-muted-foreground">{saving ? "Saving product changes..." : saveStatus === "saved" ? "Saved successfully." : saveStatus === "failed" ? "Failed to save." : saveStatus === "mfa_required" ? "MFA verification required." : "Unsaved changes stay local until saved."}</p>
          </div>
          <Button type="button" onClick={submit} disabled={saving}>{saving ? "Saving..." : mode === "edit" ? "Save Product" : "Create Product"}</Button>
        </div>
      </div>
      <Dialog open={stepUp.open} onOpenChange={(open) => setStepUp((state) => ({ ...state, open }))}>
        <DialogContent className="glass border-border/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Enter MFA code to continue</DialogTitle>
            <DialogDescription>
              {stepUp.method === "totp" ? "Use your authenticator app." : stepUp.maskedTarget ? `Code sent to ${stepUp.maskedTarget}.` : "Verify this product save."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>MFA code</Label>
            <Input value={stepUp.code} onChange={(event) => setStepUp((state) => ({ ...state, code: event.target.value.trim() }))} autoComplete="one-time-code" inputMode="numeric" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })}>Cancel</Button>
            <Button onClick={verifyStepUp} disabled={stepUp.busy || stepUp.code.length < 6}>Verify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function parseLinesToJsonArray(text: string): string[] {
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function featureKey(value: string) {
  return value.trim().toLowerCase()
}

function isGeneratedFeatureTextLine(line: string) {
  return (
    /^\d+(?:\.\d+)?\s+vCPU Cores$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+GB DDR4 RAM$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+GB (?:NVMe SSD|SSD Storage|HDD Storage)$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+TB Bandwidth$/i.test(line) ||
    /^Available in .+/i.test(line) ||
    ["ddos protection", "priority support", "daily backups"].includes(featureKey(line))
  )
}

function mergeGeneratedFeatureText(currentText: string, previousGeneratedFeatures: string[], nextGeneratedFeatures: string[]) {
  const previousGenerated = new Set(previousGeneratedFeatures.map(featureKey))
  const customLines = parseLinesToJsonArray(currentText).filter((line) => {
    const key = featureKey(line)
    return !previousGenerated.has(key) && !isGeneratedFeatureTextLine(line)
  })
  const seen = new Set<string>()
  const merged = [...nextGeneratedFeatures, ...customLines].filter((line) => {
    const key = featureKey(line)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return merged.join("\n")
}

function productLikeFromForm(form: ProductFormState) {
  return {
    cpuCores: form.cpuCores,
    ramGb: form.ramGb,
    storageGb: form.storageGb,
    storageType: form.storageType,
    requiredStorageType: form.requiredStorageType,
    bandwidthTb: form.bandwidthTb,
    specs: parseKeyValueRows(form.specs),
    regions: parseRegions(form.regions),
    features: [],
  }
}

export function parseCommaTagsToJsonArray(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter(Boolean)
}

export function parseCountryCodes(text: string): string[] {
  return Array.from(new Set(text.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z]{2}$/.test(item))))
}

export function parseBillingTerms(selection: number[]): number[] {
  const selected = BILLING_TERMS.filter((term) => selection.includes(term))
  return selected.length ? selected : [1]
}

export function parseKeyValueRows(rows: SpecRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.label.trim()
    const value = row.value.trim()
    if (key && value) acc[key] = value
    return acc
  }, {})
}

export function calculateMonthlyOverrides(basePrice: number): MonthlyOverrideValues {
  return {
    price3m: (basePrice * 0.95).toFixed(2),
    price6m: (basePrice * 0.9).toFixed(2),
    price12m: (basePrice * 0.85).toFixed(2),
    price24m: (basePrice * 0.8).toFixed(2),
    price36m: (basePrice * 0.75).toFixed(2),
  }
}

function monthlyOverrideMatches(value: string, expected: string) {
  const actualNumber = Number(value)
  const expectedNumber = Number(expected)
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return Math.abs(actualNumber - expectedNumber) < 0.005
  }
  return value.trim() === expected.trim()
}

function parseRegions(rows: RegionRow[]) {
  return rows
    .map((row) => ({ name: row.name.trim(), slug: row.code.trim(), code: row.code.trim(), enabled: row.enabled }))
    .filter((row) => row.name || row.slug)
}

function parseAdvancedJson(value: string, fallback: unknown) {
  if (!value.trim()) return fallback
  return JSON.parse(value)
}

function advancedValue(value: unknown, fallback: unknown): AdvancedField {
  try {
    return { value: JSON.stringify(value ?? fallback, null, 2) }
  } catch {
    return { value: JSON.stringify(fallback, null, 2), warning: "Existing value could not be formatted and was reset to a safe default." }
  }
}

function formFromProduct(product: any): ProductFormState {
  const meta = product?.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata) ? product.metadata as Record<string, any> : {}
  const dedicated = meta.dedicated || {}
  const geoVisibility = meta.geoVisibility || {}
  return {
    ...emptyForm,
    ...product,
    status: ["active", "draft"].includes(String(product.status || "").toLowerCase()) ? String(product.status).toLowerCase() : "draft",
    price1m: String(product.price1m ?? "0"),
    price3m: product.price3m == null ? "" : String(product.price3m),
    price6m: product.price6m == null ? "" : String(product.price6m),
    price12m: product.price12m == null ? "" : String(product.price12m),
    price24m: product.price24m == null ? "" : String(product.price24m),
    price36m: product.price36m == null ? "" : String(product.price36m),
    cpuCores: String(product.cpuCores ?? "0"),
    ramGb: String(product.ramGb ?? "0"),
    storageGb: String(product.storageGb ?? "0"),
    storageType: String(product.storageType ?? "nvme"),
    defaultNodeId: product.defaultNodeId == null ? "" : String(product.defaultNodeId),
    storagePolicyType: String(product.storagePolicyType ?? "NODE_DEFAULT"),
    requiredStorageType: product.requiredStorageType == null ? "" : String(product.requiredStorageType),
    requiredStoragePoolId: product.requiredStoragePoolId == null ? "" : String(product.requiredStoragePoolId),
    allowStorageFallback: product.allowStorageFallback !== false,
    bandwidthTb: String(product.bandwidthTb ?? "0"),
    backupEnabled: Boolean(product.backupEnabled),
    backupPrice: String(product.backupPrice ?? "0"),
    backupStorageGb: String(product.backupStorageGb ?? "0"),
    snapshotEnabled: Boolean(product.snapshotEnabled),
    snapshotPrice: String(product.snapshotPrice ?? "0"),
    snapshotIncludedCount: String(product.snapshotIncludedCount ?? "0"),
    bandwidthEnabled: product.bandwidthEnabled !== false,
    bandwidthPrice: String(product.bandwidthPrice ?? "0"),
    bandwidthLimitTb: product.bandwidthLimitTb == null ? "" : String(product.bandwidthLimitTb),
    bandwidthOveragePrice: String(product.bandwidthOveragePrice ?? "0"),
    extraIpv4Price: String(product.extraIpv4Price ?? "0"),
    billingTerms: Array.isArray(product.billingTerms) ? product.billingTerms.map(Number).filter(Boolean) : [1, 3, 6, 12, 24, 36],
    regions: regionsFromJson(product.regions),
    badgesText: Array.isArray(product.badges) ? product.badges.filter(Boolean).join(", ") : "",
    featuresText: Array.isArray(product.features) ? product.features.filter(Boolean).join("\n") : "",
    specs: specsFromJson(product.specs),
    seoKeywordsText: Array.isArray(product.seoKeywords) ? product.seoKeywords.filter(Boolean).join(", ") : "",
    optionGroups: advancedValue(product.optionGroups, []),
    serviceAttributes: advancedValue(product.serviceAttributes, {}),
    dedicatedDeliverySlaHours: String(dedicated.deliverySlaHours ?? 72),
    dedicatedBandwidthLabel: String(dedicated.bandwidthLabel ?? ""),
    dedicatedLocation: String(dedicated.location ?? "India"),
    dedicatedSetupFee: dedicated.setupFee == null ? "" : String(dedicated.setupFee),
    dedicatedPurchaseEnabled: dedicated.purchaseEnabled !== false,
    dedicatedWhatsappEnabled: dedicated.whatsappEnabled !== false,
    dedicatedAllowCustomOsRequest: dedicated.allowCustomOsRequest !== false,
    autoProvision: meta.autoProvision === true ? "on" : meta.autoProvision === false ? "off" : "inherit",
    consoleEnabled: meta.consoleEnabled !== false,
    geoVisibilityMode: String(geoVisibility.mode || "global"),
    geoAllowedCountriesText: Array.isArray(geoVisibility.allowedCountries) ? geoVisibility.allowedCountries.join(", ") : "",
    geoBlockedCountriesText: Array.isArray(geoVisibility.blockedCountries) ? geoVisibility.blockedCountries.join(", ") : "",
    premiumIpEnabled: Boolean(product.premiumIpEnabled),
  }
}

function ProductIpPoolControls({
  pools,
  premiumEnabled,
  onPremiumEnabledChange,
  assignments,
  onAssignmentsChange,
}: {
  pools: IpPoolOption[]
  premiumEnabled: boolean
  onPremiumEnabledChange: (checked: boolean) => void
  assignments: ProductIpAssignment[]
  onAssignmentsChange: (assignments: ProductIpAssignment[]) => void
}) {
  const assigned = new Map(assignments.map((row) => [row.poolId, row]))
  function patch(poolId: string, next: Partial<ProductIpAssignment> | null) {
    const current = assigned.get(poolId)
    let rows = assignments.filter((row) => row.poolId !== poolId)
    if (next) rows = [...rows, { poolId, isDefault: false, allowPremium: false, ...current, ...next }]
    if (next?.isDefault) rows = rows.map((row) => row.poolId === poolId ? row : { ...row, isDefault: false })
    onAssignmentsChange(rows)
  }
  return (
    <div className="space-y-3 rounded-lg border border-border/40 p-4 md:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">IP Pool Controls</h3>
          <p className="text-xs text-muted-foreground">Restrict which pools this product can use during provisioning.</p>
        </div>
        <CheckField label="Enable premium IP add-on" checked={premiumEnabled} onChange={onPremiumEnabledChange} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Pool</th><th>Type</th><th>Allowed</th><th>Default</th><th>Premium</th></tr></thead>
          <tbody>
            {pools.map((pool) => {
              const row = assigned.get(pool.id)
              const allowed = Boolean(row)
              return (
                <tr key={pool.id} className="border-b">
                  <td className="py-2"><div className="font-medium">{pool.name}</div><div className="font-mono text-xs text-muted-foreground">{pool.startIp} - {pool.endIp}/{pool.cidr}</div></td>
                  <td className="capitalize">{pool.type}</td>
                  <td><CheckField label="Allowed" checked={allowed} onChange={(checked) => patch(pool.id, checked ? {} : null)} /></td>
                  <td><CheckField label="Default" checked={Boolean(row?.isDefault)} onChange={(checked) => patch(pool.id, { isDefault: checked, allowPremium: checked ? false : Boolean(row?.allowPremium) })} /></td>
                  <td><CheckField label="Premium" checked={Boolean(row?.allowPremium)} onChange={(checked) => patch(pool.id, { allowPremium: checked, isDefault: checked ? false : Boolean(row?.isDefault) })} /></td>
                </tr>
              )
            })}
            {!pools.length ? <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No IP pools configured.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function regionsFromJson(value: unknown): RegionRow[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === "string") return { name: item, code: item.toLowerCase().replace(/\s+/g, "-"), enabled: true }
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {}
    return {
      name: String(row.name || row.label || ""),
      code: String(row.code || row.slug || row.id || ""),
      enabled: row.enabled !== false,
    }
  })
}

function specsFromJson(value: unknown): SpecRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(([label, raw]) => ({
    label,
    value: typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? ""),
  }))
}

function formatJsonField(field: AdvancedField, fallback: unknown): AdvancedField {
  try {
    return { value: JSON.stringify(parseAdvancedJson(field.value, fallback), null, 2) }
  } catch (error) {
    return { ...field, warning: error instanceof Error ? error.message : "Invalid JSON" }
  }
}

function Field({ label, value, onChange, placeholder, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} inputMode={inputMode} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function PriceField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
      <Field label={label} type="text" inputMode="decimal" value={value} onChange={onChange} placeholder="0.00" />
    </div>
  )
}

const EMPTY_SELECT_VALUE = "__zws_empty_select_value__"

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const selectedValue = value === "" ? EMPTY_SELECT_VALUE : value

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={selectedValue} onValueChange={(nextValue) => onChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}>
        <SelectTrigger className="h-9 w-full">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, labelText]) => {
            const renderedValue = optionValue === "" ? EMPTY_SELECT_VALUE : optionValue

            return <SelectItem key={`${label}-${renderedValue}`} value={renderedValue}>{labelText}</SelectItem>
          })}
        </SelectContent>
      </Select>
    </div>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  )
}

function BillingTermsField({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  return (
    <div className="space-y-2 md:col-span-2">
      <Label>Billing Terms</Label>
      <div className="flex flex-wrap gap-3">
        {BILLING_TERMS.map((term) => (
          <CheckField
            key={term}
            label={`${term} month${term === 1 ? "" : "s"}`}
            checked={value.includes(term)}
            onChange={(checked) => onChange(checked ? [...value, term] : value.filter((item) => item !== term))}
          />
        ))}
      </div>
    </div>
  )
}

function RegionsField({ value, onChange }: { value: RegionRow[]; onChange: (value: RegionRow[]) => void }) {
  return (
    <div className="space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Regions</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: "", code: "", enabled: true }])}><Plus className="mr-2 h-4 w-4" />Add Region</Button>
      </div>
      <div className="space-y-2">
        {value.length ? value.map((row, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
            <Input value={row.name} onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="India" />
            <Input value={row.code} onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, code: event.target.value } : item))} placeholder="in" />
            <CheckField label="Enabled" checked={row.enabled} onChange={(checked) => onChange(value.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label="Remove region"><Trash2 className="h-4 w-4" /></Button>
          </div>
        )) : <p className="text-sm text-muted-foreground">No regions configured.</p>}
      </div>
    </div>
  )
}

function SpecsField({ value, onChange }: { value: SpecRow[]; onChange: (value: SpecRow[]) => void }) {
  return (
    <div className="space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Specs</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { label: "", value: "" }])}><Plus className="mr-2 h-4 w-4" />Add Spec</Button>
      </div>
      <div className="space-y-2">
        {value.length ? value.map((row, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input value={row.label} onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} placeholder="vCPU" />
            <Input value={row.value} onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} placeholder="16 cores" />
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label="Remove spec"><Trash2 className="h-4 w-4" /></Button>
          </div>
        )) : <p className="text-sm text-muted-foreground">No custom specs configured.</p>}
      </div>
    </div>
  )
}

function AdvancedSettings({ form, update }: { form: ProductFormState; update: <Key extends keyof ProductFormState>(key: Key, value: ProductFormState[Key]) => void }) {
  return (
    <Collapsible className="space-y-4 md:col-span-2 rounded-lg border border-border/40 p-4">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline">Advanced settings</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        <AdvancedJsonField label="Option Groups" field={form.optionGroups} fallback={[]} onChange={(field) => update("optionGroups", field)} />
        <AdvancedJsonField label="Service Attributes" field={form.serviceAttributes} fallback={{}} onChange={(field) => update("serviceAttributes", field)} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function AdvancedJsonField({ label, field, fallback, onChange }: { label: string; field: AdvancedField; fallback: unknown; onChange: (field: AdvancedField) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label} JSON</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(formatJsonField(field, fallback))}>Validate & format</Button>
      </div>
      <Textarea value={field.value} onChange={(event) => onChange({ value: event.target.value })} rows={5} className="font-mono text-xs" />
      {field.warning ? <p className="text-xs text-destructive">{field.warning}</p> : null}
    </div>
  )
}
