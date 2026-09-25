"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { PhonePeBridgeModal } from "@/components/payments/PhonePeBridgeModal"
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  HardDrive,
  MemoryStick,
  MonitorCog,
  Network,
  Clock,
  Zap,
  Plus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  formatPrice,
  formatHourlyPrice,
  getProductPrice,
  getTermDiscountRate,
  getTermLabel,
  type BillingTerm,
} from "@/lib/pricing"
import {
  calculateCustomConfigurationQuote,
  getCustomConfigurationDiscountPercent,
  type CustomConfigurationSettings,
} from "@/lib/custom-configuration-pricing"
import { getCloudInstanceName } from "@/lib/cloud-instance-names"
import { parseJsonResponse, readJsonResponse } from "@/lib/client/safe-json"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { formatCurrency } from "@/lib/currency-format"
import { paymentClientMessage } from "@/lib/client/payment-errors"

type DiskConfig = {
  type: "nvme" | "ssd"
  sizeGb: number
  label?: string
}

type StoragePoolOption = {
  id: string
  displayName: string
  storageTypeLabel: string
  pricePerGbMonthly: number
  minGb: number
  maxGb: number | null
  availableGb: number | null
  isPremium: boolean
}

type PublicProduct = {
  id: string
  slug: string
  name: string
  type: "fixed_vps" | "configurable" | "dedicated"
  ctaMode?: "purchase_now" | "configure" | "contact_sales"
  ctaLabel?: string | null
  description: string | null
  shortDescription: string | null
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType: "nvme" | "ssd"
  bandwidthTb: number
  price1m: number
  price3m: number | null
  price6m: number | null
  price12m: number | null
  price24m: number | null
  price36m: number | null
  pricing: {
    monthly: number
    termPrice: number
    hourly: number
    term: number
    termTotal: number
  }
  specs?: Record<string, unknown> | null
  optionGroups?: unknown[] | null
  regions?: unknown[] | null
  billingTerms?: unknown[] | null
}

type SliderLimit = {
  min: number
  max: number
  default: number
  step: number
}

type ConfiguratorLimits = {
  cpu: SliderLimit
  ram: SliderLimit
  storage: {
    nvme: SliderLimit
    ssd: SliderLimit
  }
  bandwidth: SliderLimit & { included: number }
  disks: { min: number; max: number }
}

type NamedOption = {
  id: string
  name: string
  priceAddon: number
}

type ValueOption = {
  label: string
  value: number
}

type OperatingSystem = {
  id: string
  name: string
  slug: string
  osType: string
  category: string
  proxmoxVmid: number
  proxmoxTemplateName: string | null
  proxmoxNodeId: string | null
  source: string | null
}

const DEFAULT_LIMITS: ConfiguratorLimits = {
  cpu: { min: 1, max: 64, default: 4, step: 1 },
  ram: { min: 2, max: 256, default: 8, step: 2 },
  storage: {
    nvme: { min: 40, max: 4000, default: 160, step: 20 },
    ssd: { min: 40, max: 8000, default: 160, step: 20 },
  },
  bandwidth: { min: 1, max: 100, default: 2, step: 1, included: 10 },
  disks: { min: 1, max: 5 },
}

const DEFAULT_REGIONS: NamedOption[] = [
  { id: "bom", name: "Mumbai (BOM)", priceAddon: 0 },
  { id: "blr", name: "Bengaluru (BLR)", priceAddon: 0 },
  { id: "sin", name: "Singapore (SIN)", priceAddon: 0 },
  { id: "fra", name: "Frankfurt (FRA)", priceAddon: 0 },
]

const DEFAULT_BANDWIDTH_OPTIONS: ValueOption[] = [
  { label: "1 TB", value: 1 },
  { label: "2 TB", value: 2 },
  { label: "4 TB", value: 4 },
  { label: "8 TB", value: 8 },
  { label: "16 TB", value: 16 },
  { label: "32 TB", value: 32 },
  { label: "50 TB", value: 50 },
  { label: "Unmetered", value: 100 },
]

const DEFAULT_BILLING_TERMS: BillingTerm[] = [1, 3, 6, 12, 24, 36]

function getTotalStorageGb(disks: DiskConfig[]) {
  return disks.reduce((sum, disk) => sum + Number(disk.sizeGb || 0), 0)
}

function getDiskLabels(disks: DiskConfig[]) {
  return disks
    .map((disk, index) => `${disk.label || `Disk ${index + 1}`} (${disk.sizeGb}GB ${disk.type.toUpperCase()})`)
    .join(" + ")
}

function normalizeSliderLimit(value: unknown, fallback: SliderLimit): SliderLimit {
  if (!value || typeof value !== "object") return fallback
  const source = value as Partial<Record<keyof SliderLimit, number>>
  return {
    min: Number(source.min ?? fallback.min),
    max: Number(source.max ?? fallback.max),
    default: Number(source.default ?? fallback.default),
    step: Number(source.step ?? fallback.step),
  }
}

function normalizeNamedOptions(input: unknown, fallback: NamedOption[]): NamedOption[] {
  if (!Array.isArray(input) || input.length === 0) return fallback
  const options = input
    .map((entry, index) => {
      if (typeof entry === "string") {
        return { id: `${index}`, name: entry, priceAddon: 0 }
      }
      if (entry && typeof entry === "object") {
        const item = entry as Record<string, unknown>
        const name = String(item.name || item.label || item.value || "").trim()
        if (!name) return null
        return {
          id: String(item.id || item.value || index),
          name,
          priceAddon: Number(item.priceAddon || item.addon || 0),
        }
      }
      return null
    })
    .filter((option): option is NamedOption => Boolean(option))

  return options.length > 0 ? options : fallback
}

function normalizeBandwidthOptions(input: unknown, limits: ConfiguratorLimits): ValueOption[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_BANDWIDTH_OPTIONS
  const options = input
    .map((entry) => {
      if (typeof entry === "number") {
        return { label: `${entry} TB`, value: entry }
      }
      if (entry && typeof entry === "object") {
        const item = entry as Record<string, unknown>
        const numericValue = Number(item.value ?? item.amount ?? item.tb)
        if (!Number.isFinite(numericValue)) return null
        return {
          label: String(item.label || `${numericValue} TB`),
          value: numericValue,
        }
      }
      return null
    })
    .filter((option): option is ValueOption => Boolean(option))

  if (options.length > 0) return options

  return [
    { label: `${limits.bandwidth.min} TB`, value: limits.bandwidth.min },
    { label: `${limits.bandwidth.default} TB`, value: limits.bandwidth.default },
    { label: `${limits.bandwidth.max} TB`, value: limits.bandwidth.max },
  ]
}

function normalizeBillingTerms(input: unknown): BillingTerm[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_BILLING_TERMS
  const terms = input
    .map((entry) => Number(typeof entry === "object" && entry ? (entry as { value?: unknown }).value : entry))
    .filter((value): value is BillingTerm => [1, 3, 6, 12, 24, 36].includes(value))

  return terms.length > 0 ? terms : DEFAULT_BILLING_TERMS
}

function getOptionGroup(options: unknown[] | null | undefined, keys: string[]) {
  if (!Array.isArray(options)) return null
  return options.find((group) => {
    if (!group || typeof group !== "object") return false
    const item = group as Record<string, unknown>
    const key = String(item.key || item.slug || item.name || "").toLowerCase()
    return keys.includes(key)
  }) as Record<string, unknown> | null
}

function getFixedProductMonthly(product: PublicProduct, term: BillingTerm) {
  return getProductPrice(
    {
      id: product.id,
      slug: product.slug,
      name: product.name,
      cpuCores: product.cpuCores,
      ramGb: product.ramGb,
      storageGb: product.storageGb,
      storageType: product.storageType,
      bandwidthTb: product.bandwidthTb,
      price1m: product.price1m,
      price3m: product.price3m,
      price6m: product.price6m,
      price12m: product.price12m,
      price24m: product.price24m,
      price36m: (product as any).price36m ?? null,
      priceHourly: null,
      features: [],
    },
    term,
  )
}

let configuratorMountCount = 0

export function Configurator({ customSettings }: { customSettings: CustomConfigurationSettings }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedProductSlug = searchParams.get("product")
  const requestedOperatingSystemId = searchParams.get("os")
  const requestedCpu = Number(searchParams.get("cpu") || 0)
  const requestedRam = Number(searchParams.get("ram") || 0)
  const requestedStorage = Number(searchParams.get("storage") || 0)
  const requestedTerm = Number(searchParams.get("cycle") || searchParams.get("term") || 1)
  const requestedMode = searchParams.get("mode")

  const [products, setProducts] = useState<PublicProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string>(requestedProductSlug || "")
  const [operatingSystems, setOperatingSystems] = useState<OperatingSystem[]>([])
  const [operatingSystemsLoading, setOperatingSystemsLoading] = useState(true)
  const [operatingSystemId, setOperatingSystemId] = useState<string>(requestedOperatingSystemId || "")
  const [cpu, setCpu] = useState<number[]>([DEFAULT_LIMITS.cpu.default])
  const [ram, setRam] = useState<number[]>([DEFAULT_LIMITS.ram.default])
  const [disks, setDisks] = useState<DiskConfig[]>([{ type: "nvme", sizeGb: 160, label: "Disk 1" }])
  const [storagePools, setStoragePools] = useState<StoragePoolOption[]>([])
  const [selectedStoragePoolId, setSelectedStoragePoolId] = useState("")
  const [bandwidth, setBandwidth] = useState<number>(DEFAULT_LIMITS.bandwidth.default)
  const [region, setRegion] = useState<string>(DEFAULT_REGIONS[0].name)
  const [term, setTerm] = useState<BillingTerm>(DEFAULT_BILLING_TERMS.includes(requestedTerm as BillingTerm) ? (requestedTerm as BillingTerm) : 1)
  const [submitting, setSubmitting] = useState(false)
  const [hostname, setHostname] = useState("")
  const [adminUsername, setAdminUsername] = useState("root")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [accessMethod, setAccessMethod] = useState<"PASSWORD" | "SAVED_SSH_KEY" | "GENERATED_SSH_KEY" | "PASTED_SSH_KEY">("PASSWORD")
  const [sshPublicKey, setSshPublicKey] = useState("")
  const [sshKeyId, setSshKeyId] = useState<string | null>(null)
  const [savedKeys, setSavedKeys] = useState<any[]>([])
  const [saveSshKey, setSaveSshKey] = useState(false)
  const [sshKeyLabel, setSshKeyLabel] = useState("")
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState<string | null>(null)
  const [privateKeyConfirmed, setPrivateKeyConfirmed] = useState(false)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [phonePeBridgeUrl, setPhonePeBridgeUrl] = useState<string | null>(null)
  const draftDirtyRef = useRef(false)
  const focusedFieldRef = useRef<string | null>(null)
  const passwordRequirements = useMemo(() => passwordRequirementRows(password), [password])

  useEffect(() => {
    configuratorMountCount += 1
    if (process.env.NODE_ENV !== "production" && configuratorMountCount > 1) {
      console.debug(`[Configurator] mounted ${configuratorMountCount} times`)
    }
  }, [])

  useEffect(() => {
    function onBridge(event: Event) {
      const detail = (event as CustomEvent<{ bridgeUrl?: string }>).detail
      if (detail?.bridgeUrl) setPhonePeBridgeUrl(detail.bridgeUrl)
    }
    window.addEventListener("zws:payment-bridge", onBridge)
    return () => window.removeEventListener("zws:payment-bridge", onBridge)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const res = await fetch("/api/storage-pools", { cache: "no-store" })
      const data = await readJsonResponse<any>(res)
      if (active && res.ok) setStoragePools(data.pools || [])
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  function canApplyServerDefault() {
    return !draftDirtyRef.current && !focusedFieldRef.current
  }

  function markDraftEdited() {
    draftDirtyRef.current = true
  }

  function generatePassword() {
    const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"]
    const charset = groups.join("")
    const bytes = new Uint8Array(18)
    globalThis.crypto?.getRandomValues(bytes)
    const required = groups.map((group, index) => group[bytes[index] % group.length])
    const rest = Array.from(bytes.slice(required.length), (byte) => charset[byte % charset.length])
    markDraftEdited()
    setPassword([...required, ...rest].sort(() => Math.random() - 0.5).join(""))
  }

  async function copyPassword() {
    if (!password || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(password).catch(() => null)
    toast.success("Password copied")
  }

  function focusDraftField(field: string) {
    focusedFieldRef.current = field
  }

  function blurDraftField(field: string) {
    if (focusedFieldRef.current === field) focusedFieldRef.current = null
  }

  useEffect(() => {
    let active = true
    async function loadOperatingSystems() {
      try {
        const res = await fetch("/api/operating-systems", { credentials: "include" })
        const data = await parseJsonResponse(res)
        if (!active) return
        const items = Array.isArray(data) ? (data as OperatingSystem[]) : []
        setOperatingSystems(items)
        if (canApplyServerDefault()) {
          setOperatingSystemId((current) => {
            const desired = String(current || requestedOperatingSystemId || "")
            if (desired && items.some((o) => o.id === desired)) return desired
            return String(items[0]?.id || "")
          })
        }
      } catch {
        if (active) {
          setOperatingSystems([])
          setOperatingSystemId("")
        }
      } finally {
        if (active) setOperatingSystemsLoading(false)
      }
    }
    void loadOperatingSystems()
    return () => {
      active = false
    }
  }, [requestedOperatingSystemId])

  useEffect(() => {
    let active = true
    async function loadSavedKeys() {
      try {
        const res = await fetch("/api/client/ssh-keys", { credentials: "include" })
        if (!res.ok) return
        const data = await parseJsonResponse(res)
        if (!active) return
        const keys = Array.isArray(data) ? data : Array.isArray(data.keys) ? data.keys : []
        setSavedKeys(keys)
        if (canApplyServerDefault()) {
          setSshKeyId((current) => current || keys.find((key: any) => key.isDefault)?.id || keys[0]?.id || null)
        }
      } catch {
        if (active) setSavedKeys([])
      }
    }
    void loadSavedKeys()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadProducts() {
      try {
        const endpoint =
          requestedMode === "deploy" && requestedProductSlug
            ? `/api/products?slug=${encodeURIComponent(requestedProductSlug)}`
            : "/api/products?type=configurable"
        const res = await fetch(endpoint, { credentials: "include" })
        const data = await parseJsonResponse(res)
        if (!active) return

        const rawProducts = Array.isArray(data?.products) ? data.products : []
        const nextProducts = rawProducts.filter((product: PublicProduct) => {
          if (product.type === "dedicated") return false
          if (requestedMode === "deploy") return product.type === "fixed_vps" || product.type === "configurable"
          return product.type === "configurable"
        })
        setProducts(nextProducts)

        if (!selectedSlug) {
          const preferred =
            nextProducts.find((product: PublicProduct) => product.slug === requestedProductSlug) ||
            nextProducts.find((product: PublicProduct) => product.type === "configurable") ||
            nextProducts[0]

          if (preferred) {
            setSelectedSlug(preferred.slug)
          }
        }
      } catch {
        if (active) {
          setProducts([])
        }
      } finally {
        if (active) {
          setLoadingProducts(false)
        }
      }
    }

    void loadProducts()
    return () => {
      active = false
    }
  }, [requestedMode, requestedProductSlug, selectedSlug])

  const selectedProduct = useMemo(
    () => products.find((product) => product.slug === selectedSlug) || null,
    [products, selectedSlug],
  )

  const derivedConfig = useMemo(() => {
    const specs = selectedProduct?.specs && typeof selectedProduct.specs === "object" ? selectedProduct.specs : {}
    const optionGroups = Array.isArray(selectedProduct?.optionGroups) ? selectedProduct.optionGroups : []
    const bandwidthGroup = getOptionGroup(optionGroups, ["bandwidth", "traffic"])
    const customMode = selectedProduct?.type === "configurable"

    const limits: ConfiguratorLimits = {
      cpu: customMode
        ? { min: customSettings.minimumVcpu, max: customSettings.maximumVcpu, default: customSettings.defaultVcpu, step: 1 }
        : normalizeSliderLimit((specs as Record<string, unknown>).cpu, {
            ...DEFAULT_LIMITS.cpu,
            default: selectedProduct?.cpuCores || DEFAULT_LIMITS.cpu.default,
          }),
      ram: customMode
        ? { min: customSettings.minimumRamGb, max: customSettings.maximumRamGb, default: customSettings.defaultRamGb, step: 1 }
        : normalizeSliderLimit((specs as Record<string, unknown>).ram, {
            ...DEFAULT_LIMITS.ram,
            default: selectedProduct?.ramGb || DEFAULT_LIMITS.ram.default,
          }),
      storage: {
        nvme: customMode
          ? { min: customSettings.minimumStorageGb, max: customSettings.maximumStorageGb, default: customSettings.defaultStorageGb, step: 10 }
          : normalizeSliderLimit((specs as Record<string, unknown>).storageNvme || (specs as Record<string, unknown>).storage, {
              ...DEFAULT_LIMITS.storage.nvme,
              default: selectedProduct?.storageType === "nvme" ? selectedProduct.storageGb : DEFAULT_LIMITS.storage.nvme.default,
            }),
        ssd: customMode
          ? { min: customSettings.minimumStorageGb, max: customSettings.maximumStorageGb, default: customSettings.defaultStorageGb, step: 10 }
          : normalizeSliderLimit((specs as Record<string, unknown>).storageSsd || (specs as Record<string, unknown>).storage, {
              ...DEFAULT_LIMITS.storage.ssd,
              default: selectedProduct?.storageType === "ssd" ? selectedProduct.storageGb : DEFAULT_LIMITS.storage.ssd.default,
            }),
      },
      bandwidth: customMode
        ? { min: customSettings.minimumBandwidthTb, max: customSettings.maximumBandwidthTb, default: customSettings.defaultBandwidthTb, step: 1, included: 0 }
        : {
            ...normalizeSliderLimit((specs as Record<string, unknown>).bandwidth, {
              ...DEFAULT_LIMITS.bandwidth,
              default: Math.max(1, Math.round(selectedProduct?.bandwidthTb || DEFAULT_LIMITS.bandwidth.default)),
            }),
            included: Number(
              ((specs as Record<string, unknown>).pricing as Record<string, unknown> | undefined)?.includedBandwidthTb ||
                DEFAULT_LIMITS.bandwidth.included,
            ),
          },
      disks: {
        min: Number(((specs as Record<string, unknown>).disks as Record<string, unknown> | undefined)?.min || DEFAULT_LIMITS.disks.min),
        max: customMode ? customSettings.maximumDisks : Number(((specs as Record<string, unknown>).disks as Record<string, unknown> | undefined)?.max || DEFAULT_LIMITS.disks.max),
      },
    }

    const regions = normalizeNamedOptions(selectedProduct?.regions, DEFAULT_REGIONS)
    const bandwidthOptions = customMode
      ? Array.from(new Set([limits.bandwidth.min, limits.bandwidth.default, limits.bandwidth.max]))
          .sort((a, b) => a - b)
          .map((value) => ({ label: `${value} TB`, value }))
      : normalizeBandwidthOptions(
          bandwidthGroup?.options || (specs as Record<string, unknown>).bandwidthOptions,
          limits,
        )
    const billingTerms = normalizeBillingTerms(selectedProduct?.billingTerms)

    return {
      specs,
      limits,
      regions,
      bandwidthOptions,
      billingTerms,
    }
  }, [customSettings, selectedProduct])

  const isDeployMode = requestedMode === "deploy" || (selectedProduct ? selectedProduct.type !== "configurable" : false)

  useEffect(() => {
    if (!selectedProduct) return
    if (!canApplyServerDefault()) return

    const configSpecs = derivedConfig.specs as Record<string, unknown>
    const initialStorage = requestedStorage || selectedProduct.storageGb || derivedConfig.limits.storage[selectedProduct.storageType].default
    const diskType = selectedProduct.storageType || "nvme"
    const initialRegion = derivedConfig.regions[0]?.name || DEFAULT_REGIONS[0].name
    const allowedTerms = derivedConfig.billingTerms
    const preferredTerm = allowedTerms.includes(term) ? term : allowedTerms[0] || 1

    setCpu([Math.min(Math.max(requestedCpu || selectedProduct.cpuCores || derivedConfig.limits.cpu.default, derivedConfig.limits.cpu.min), derivedConfig.limits.cpu.max)])
    setRam([Math.min(Math.max(requestedRam || selectedProduct.ramGb || derivedConfig.limits.ram.default, derivedConfig.limits.ram.min), derivedConfig.limits.ram.max)])
    setBandwidth(Math.min(Math.max(Math.round(selectedProduct.bandwidthTb || derivedConfig.limits.bandwidth.default), derivedConfig.limits.bandwidth.min), derivedConfig.limits.bandwidth.max))
    setDisks([
      {
        type: diskType,
        sizeGb: Math.min(Math.max(initialStorage, derivedConfig.limits.storage[diskType].min), derivedConfig.limits.storage[diskType].max),
        label: "Disk 1",
      },
    ])
    setRegion(String(configSpecs.defaultRegion || initialRegion))
    setTerm(preferredTerm)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id])

  function addDisk() {
    if (isDeployMode) return
    if (disks.length < derivedConfig.limits.disks.max) {
      markDraftEdited()
      const newDiskNumber = disks.length + 1
      setDisks([
        ...disks,
        {
          type: selectedProduct?.storageType || "nvme",
          sizeGb: derivedConfig.limits.storage[selectedProduct?.storageType || "nvme"].default,
          label: `Disk ${newDiskNumber}`,
        },
      ])
    }
  }

  function removeDisk(index: number) {
    if (isDeployMode) return
    if (disks.length > derivedConfig.limits.disks.min) {
      markDraftEdited()
      setDisks(disks.filter((_, i) => i !== index))
    }
  }

  function updateDisk(index: number, updates: Partial<DiskConfig>) {
    if (isDeployMode) return
    markDraftEdited()
    const next = [...disks]
    next[index] = { ...next[index], ...updates }
    setDisks(next)
  }

  const pricing = useMemo(() => {
    if (!selectedProduct) {
      return {
        baseMonthly: 0,
        discountedMonthly: 0,
        hourly: 0,
        termTotal: 0,
        savingsPercentage: 0,
        breakdown: { cpu: 0, ram: 0, storage: 0, bandwidth: 0, bandwidthIncluded: 0 },
        monthlyWithOs: 0,
        hourlyWithOs: 0,
        termTotalWithOs: 0,
        osCharge: 0,
        subtotalBeforeTax: 0,
        taxAmount: 0,
      }
    }

    if (isDeployMode) {
      const monthly = getFixedProductMonthly(selectedProduct, term)
      return {
        baseMonthly: monthly,
        discountedMonthly: monthly,
        hourly: monthly / 730,
        termTotal: monthly * term,
        savingsPercentage: Math.round(getTermDiscountRate(term) * 100),
        breakdown: { cpu: 0, ram: 0, storage: 0, bandwidth: 0, bandwidthIncluded: selectedProduct.bandwidthTb },
        monthlyWithOs: monthly,
        hourlyWithOs: monthly / 730,
        termTotalWithOs: monthly * term,
        osCharge: 0,
        subtotalBeforeTax: monthly * term,
        taxAmount: 0,
      }
    }

    const osCharge = 0
    const totalStorageGb = getTotalStorageGb(disks)
    const primaryStorageType = disks[0]?.type || "nvme"
    const selectedStoragePool = storagePools.find((pool) => pool.id === selectedStoragePoolId) || null

    const basePricing = calculateCustomConfigurationQuote(
      {
        cpuCores: cpu[0],
        ramGb: ram[0],
        disks,
        storageGb: totalStorageGb,
        storageType: primaryStorageType,
        bandwidthTb: bandwidth,
        term,
      },
      customSettings,
    )

    if (selectedStoragePool) {
      const storageMonthly = Number((totalStorageGb * Number(selectedStoragePool.pricePerGbMonthly || 0)).toFixed(2))
      basePricing.breakdown.storage = storageMonthly
      basePricing.baseMonthly = Number((basePricing.breakdown.cpu + basePricing.breakdown.ram + basePricing.breakdown.storage + basePricing.breakdown.bandwidth).toFixed(2))
      const discount = getCustomConfigurationDiscountPercent(customSettings, term)
      basePricing.discountedMonthly = Number((basePricing.baseMonthly * (1 - discount / 100)).toFixed(2))
      basePricing.subtotal = Number((basePricing.discountedMonthly * term).toFixed(2))
      basePricing.taxAmount = Number((basePricing.subtotal * (basePricing.taxRate / 100)).toFixed(2))
      basePricing.grandTotal = Number((basePricing.subtotal + basePricing.taxAmount).toFixed(2))
    }

    const monthlyWithOs = basePricing.discountedMonthly + osCharge
    return {
      baseMonthly: basePricing.baseMonthly,
      discountedMonthly: basePricing.discountedMonthly,
      hourly: basePricing.discountedMonthly / 730,
      termTotal: basePricing.subtotal,
      savingsPercentage: basePricing.discountPercent,
      breakdown: { ...basePricing.breakdown, bandwidthIncluded: 0 },
      monthlyWithOs,
      hourlyWithOs: monthlyWithOs / 730,
      termTotalWithOs: basePricing.grandTotal,
      osCharge,
      subtotalBeforeTax: basePricing.subtotal,
      taxAmount: basePricing.taxAmount,
    }
  }, [bandwidth, cpu, customSettings, disks, isDeployMode, ram, selectedProduct, selectedStoragePoolId, storagePools, term])
  const accessSummary = "Password login"

  async function handleOrder() {
    if (!selectedProduct) {
      toast.error("Choose a product first")
      return
    }

    if (!operatingSystemId) {
      toast.error("No operating systems available. Please contact support.")
      return
    }
    if (!hostname || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(hostname)) {
      toast.error("Enter a valid instance name before ordering.")
      return
    }
    if (passwordStrengthScore(password) < 2) {
      toast.error("Use at least 8 characters with a mix of letters and numbers.")
      return
    }

    setSubmitting(true)
    try {
      const selectedOperatingSystem = operatingSystems.find((o) => o.id === operatingSystemId) || null
      const res = await fetch("/api/payments/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          purpose: "order_payment",
          term,
          operatingSystemId,
          config: isDeployMode
            ? undefined
            : {
                cpu: cpu[0],
                ram: ram[0],
                disks,
                storagePoolId: selectedStoragePoolId || undefined,
                bandwidth,
                operatingSystemId,
                operatingSystemName: selectedOperatingSystem?.name || null,
                region,
                term,
              },
          amount: pricing.termTotalWithOs,
          monthlyAmount: pricing.monthlyWithOs,
          hostname,
          adminUsername: "root",
          accessMethod: "PASSWORD",
          password,
        }),
      })

      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        if (data?.code === "login_required") {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
          return
        }
        if (data?.code === "profile_incomplete") {
          throw new Error(data.error || "Complete your profile before payment.")
        }
        const requestId = String(data?.requestId || res.headers.get("x-request-id") || "").trim()
        const mapped = paymentClientMessage({ code: data?.code, message: data?.error || data?.message, fallback: "Request failed" })
        throw new Error(requestId ? `${mapped} (Ref: ${requestId})` : mapped)
      }

      await startPaymentRedirect(data, { push: router.push })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : ""
      const message = /fetch failed|failed to fetch|networkerror/i.test(rawMessage)
        ? "The payment service could not be reached. Try again shortly."
        : paymentClientMessage({ message: rawMessage, fallback: "Checkout failed" })
      toast.error(message, {
        description: "Please try again or contact support.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function generateSshKey() {
    setGeneratingKey(true)
    try {
      const res = await fetch("/api/client/ssh-keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ save: saveSshKey, label: sshKeyLabel || "Generated Key" }),
      })
      const data = await parseJsonResponse(res)
      if (!res.ok) throw new Error(data.error || "Failed to generate key")
      markDraftEdited()
      setSshPublicKey(data.publicKey)
      setGeneratedPrivateKey(data.privateKey)
      if (data.savedKeyId) setSshKeyId(data.savedKeyId)
      setPrivateKeyConfirmed(false)
      toast.success("SSH key pair generated")
    } catch (error: any) {
      toast.error(error?.message || "Failed to generate key")
    } finally {
      setGeneratingKey(false)
    }
  }

  return (
    <>
    {phonePeBridgeUrl ? <PhonePeBridgeModal bridgeUrl={phonePeBridgeUrl} onClose={() => setPhonePeBridgeUrl(null)} /> : null}
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-6">
        <div className="glass rounded-2xl p-6 sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Compute
          </h2>
          <div className="mt-6 flex flex-col gap-8">
            <SliderRow
              icon={Cpu}
              label="vCPU"
              unit="cores"
              value={cpu[0]}
              min={derivedConfig.limits.cpu.min}
              max={derivedConfig.limits.cpu.max}
              step={derivedConfig.limits.cpu.step}
              onChange={(value) => {
                markDraftEdited()
                setCpu(value)
              }}
              disabled={isDeployMode}
            />
            <SliderRow
              icon={MemoryStick}
              label="Memory"
              unit="GB"
              value={ram[0]}
              min={derivedConfig.limits.ram.min}
              max={derivedConfig.limits.ram.max}
              step={derivedConfig.limits.ram.step}
              onChange={(value) => {
                markDraftEdited()
                setRam(value)
              }}
              disabled={isDeployMode}
            />

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="h-4 w-4 text-accent" />
                  Storage Disks
                </div>
                <span className="text-xs text-muted-foreground">
                  {disks.length} / {derivedConfig.limits.disks.max} disks
                </span>
              </div>

              {!isDeployMode && storagePools.length ? (
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-3">
                  <Label className="text-xs text-muted-foreground">Storage type</Label>
                  <Select
                    value={selectedStoragePoolId || "node-default"}
                    onValueChange={(value) => {
                      markDraftEdited()
                      setSelectedStoragePoolId(value === "node-default" ? "" : value)
                      const pool = storagePools.find((item) => item.id === value)
                      if (pool) {
                        setDisks((current) => current.map((disk, index) => index === 0 ? {
                          ...disk,
                          type: pool.storageTypeLabel.toLowerCase().includes("ssd") ? "ssd" : "nvme",
                          sizeGb: Math.min(Math.max(disk.sizeGb, pool.minGb || disk.sizeGb), pool.maxGb || disk.sizeGb),
                        } : disk))
                      }
                    }}
                  >
                    <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="node-default">Use included default storage</SelectItem>
                      {storagePools.map((pool) => (
                        <SelectItem key={pool.id} value={pool.id}>
                          {pool.displayName} · {pool.storageTypeLabel} · {formatCurrency(pool.pricePerGbMonthly, "INR")}/GB/mo{pool.isPremium ? " · Premium" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedStoragePoolId ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Available capacity and min/max limits are enforced by the selected storage pool.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Storage: default node placement. Included disk: {getTotalStorageGb(disks)} GB.</p>
                  )}
                </div>
              ) : null}

              <div className="space-y-3">
                {disks.map((disk, index) => {
                  const selectedPool = storagePools.find((pool) => pool.id === selectedStoragePoolId) || null
                  const baseLimits = disk.type === "nvme" ? derivedConfig.limits.storage.nvme : derivedConfig.limits.storage.ssd
                  const limits = selectedPool ? { ...baseLimits, min: selectedPool.minGb || baseLimits.min, max: selectedPool.maxGb || baseLimits.max } : baseLimits

                  return (
                    <div key={index} className="glass rounded-lg p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium">{disk.label}</span>
                        {disks.length > derivedConfig.limits.disks.min ? (
                          <button
                            type="button"
                            onClick={() => removeDisk(index)}
                            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                            aria-label={`Remove ${disk.label}`}
                            disabled={isDeployMode}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>

                      <div className="space-y-3">
                        <RadioGroup
                          value={disk.type}
                          onValueChange={(value) => updateDisk(index, { type: value as "nvme" | "ssd" })}
                          className="grid grid-cols-2 gap-2"
                          disabled={Boolean(selectedStoragePoolId)}
                        >
                          <Label className="glass flex cursor-pointer flex-col items-center justify-center rounded-md px-3 py-2 text-xs transition-[background,border-color,color,transform] hover:-translate-y-px hover:text-foreground has-[[data-state=checked]]:selected-item">
                            <RadioGroupItem value="nvme" className="sr-only" disabled={isDeployMode || Boolean(selectedStoragePoolId)} />
                            <Zap className="mb-1 h-3 w-3 text-accent" />
                            <span className="font-medium">NVMe</span>
                          </Label>
                          <Label className="glass flex cursor-pointer flex-col items-center justify-center rounded-md px-3 py-2 text-xs transition-[background,border-color,color,transform] hover:-translate-y-px hover:text-foreground has-[[data-state=checked]]:selected-item">
                            <RadioGroupItem value="ssd" className="sr-only" disabled={isDeployMode || Boolean(selectedStoragePoolId)} />
                            <HardDrive className="mb-1 h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">SSD</span>
                          </Label>
                        </RadioGroup>

                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Size</span>
                            <span className="font-mono text-sm text-foreground">{disk.sizeGb} GB</span>
                          </div>
                          <Slider
                            value={[disk.sizeGb]}
                            min={limits.min}
                            max={limits.max}
                            step={limits.step}
                            onValueChange={(value) => updateDisk(index, { sizeGb: value[0] })}
                            aria-label={`${disk.label} size`}
                            disabled={isDeployMode}
                          />
                          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                            <span>{limits.min} GB</span>
                            <span>{limits.max} GB</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {disks.length < derivedConfig.limits.disks.max ? (
                <Button type="button" onClick={addDisk} variant="outline" size="sm" className="w-full gap-1.5" disabled={isDeployMode}>
                  <Plus className="h-4 w-4" />
                  Add Disk
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Network & Image
          </h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <SelectField
              icon={Network}
              label="Bandwidth"
              value={String(bandwidth)}
              onChange={(value) => {
                markDraftEdited()
                setBandwidth(Number(value))
              }}
              options={derivedConfig.bandwidthOptions.map((option) => ({
                label: option.label,
                value: String(option.value),
              }))}
              disabled={isDeployMode}
            />
            <SelectField
              icon={Globe}
              label="Region"
              value={region}
              onChange={(value) => {
                markDraftEdited()
                setRegion(value)
              }}
              options={derivedConfig.regions.map((entry) => ({ label: entry.name, value: entry.name }))}
              disabled={isDeployMode}
            />
            <SelectField
              icon={MonitorCog}
              label="Operating System"
              value={operatingSystemId}
              onChange={(value) => {
                markDraftEdited()
                setOperatingSystemId(value)
              }}
              options={operatingSystems.map((tpl) => ({ label: tpl.name, value: tpl.id, meta: tpl.category }))}
              wide
              disabled={isDeployMode || operatingSystemsLoading || operatingSystems.length === 0}
            />
            {operatingSystemsLoading ? (
              <div className="sm:col-span-2 text-xs text-muted-foreground">Loading operating systems...</div>
            ) : operatingSystems.length === 0 ? (
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                No operating systems available. Please contact support.
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-muted)]">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
            <span>
              {bandwidth <= derivedConfig.limits.bandwidth.included
                ? `All ${bandwidth} TB bandwidth included`
                : `${derivedConfig.limits.bandwidth.included} TB included + ${(bandwidth - derivedConfig.limits.bandwidth.included).toFixed(1)} TB extra`}
            </span>
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="h-4 w-4 text-accent" />
              Billing Term
            </div>
            <RadioGroup
              value={term.toString()}
              onValueChange={(value) => {
                markDraftEdited()
                setTerm(Number(value) as BillingTerm)
              }}
              className="grid grid-cols-5 gap-2"
            >
              {derivedConfig.billingTerms.map((billingTerm) => {
                const discount = isDeployMode
                  ? getTermDiscountRate(billingTerm) * 100
                  : getCustomConfigurationDiscountPercent(customSettings, billingTerm)
                return (
                  <Label
                    key={billingTerm}
                    htmlFor={`term-${billingTerm}`}
                    className="glass flex cursor-pointer flex-col items-center justify-center rounded-lg px-2 py-2.5 text-center text-sm text-muted-foreground transition-[background,border-color,color,transform] hover:-translate-y-px hover:text-foreground has-[[data-state=checked]]:selected-item"
                  >
                    <RadioGroupItem id={`term-${billingTerm}`} value={billingTerm.toString()} className="sr-only" />
                    <span className="text-xs font-medium">{getTermLabel(billingTerm)}</span>
                    {discount > 0 ? (
                      <span className="mt-0.5 text-[10px] font-medium text-accent">-{Math.round(discount)}%</span>
                    ) : null}
                  </Label>
                )
              })}
            </RadioGroup>
          </div>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="glass glass-strong flex flex-col rounded-2xl p-6 sm:p-8">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your Build</h3>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight">{formatPrice(pricing.termTotalWithOs)}</span>
            <span className="text-sm text-muted-foreground">/{term === 1 ? "mo" : `${term}mo`}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatPrice(pricing.monthlyWithOs)}/mo effective
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {formatHourlyPrice(pricing.hourlyWithOs)}
            </span>
          </div>

          {pricing.savingsPercentage > 0 ? (
            <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-selected)]">
              <CheckCircle2 className="h-3 w-3" />
              Save {pricing.savingsPercentage}% with {getTermLabel(term)} billing
            </div>
          ) : null}

          <dl className="mt-6 flex flex-col gap-3 border-t border-border pt-5 text-sm">
            <SummaryRow k="Product" v={selectedProduct ? getCloudInstanceName(selectedProduct) : "Choose a product"} />
            <SummaryRow k="Mode" v={isDeployMode ? "Direct deploy" : "Custom Cloud Instance"} />
            <SummaryRow k="vCPU" v={`${cpu[0]} cores`} />
            <SummaryRow k="Memory" v={`${ram[0]} GB DDR4`} />
            <SummaryRow k="Storage" v={getDiskLabels(disks)} />
            <SummaryRow k="Storage Type" v={storagePools.find((pool) => pool.id === selectedStoragePoolId)?.displayName || "Node default"} />
            <SummaryRow k="Total Storage" v={`${getTotalStorageGb(disks)} GB`} />
            <SummaryRow
              k="Bandwidth"
              v={derivedConfig.bandwidthOptions.find((entry) => entry.value === bandwidth)?.label ?? `${bandwidth} TB`}
            />
            <SummaryRow
              k="OS"
              v={
                operatingSystemId
                  ? operatingSystems.find((o) => o.id === operatingSystemId)?.name || "Selected OS"
                  : "No OS available"
              }
            />
            <SummaryRow k="Access" v={accessSummary} />
            <SummaryRow k="Region" v={region} />
            <SummaryRow k="Term" v={getTermLabel(term)} />
          </dl>

          <div className="mt-4 rounded-lg bg-foreground/[0.03] p-3 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>CPU ({cpu[0]} cores)</span>
              <span>{formatPrice(pricing.breakdown.cpu)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
              <span>RAM ({ram[0]} GB)</span>
              <span>{formatPrice(pricing.breakdown.ram)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
              <span>Storage ({getTotalStorageGb(disks)} GB)</span>
              <span>{formatPrice(pricing.breakdown.storage)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
              <span>Bandwidth ({bandwidth} TB)</span>
              <span>{formatPrice(pricing.breakdown.bandwidth)}</span>
            </div>
            {pricing.osCharge > 0 ? (
              <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                <span>OS Add-on</span>
                <span>{formatPrice(pricing.osCharge)}</span>
              </div>
            ) : null}
            {pricing.taxAmount > 0 ? (
              <>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-muted-foreground">
                  <span>Subtotal ({term}mo)</span>
                  <span>{formatPrice(pricing.subtotalBeforeTax)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span>{formatPrice(pricing.taxAmount)}</span>
                </div>
              </>
            ) : null}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-medium text-foreground">
              <span>{pricing.taxAmount > 0 ? "Payable Today" : "Monthly Total"}</span>
              <span>{formatPrice(pricing.taxAmount > 0 ? pricing.termTotalWithOs : pricing.monthlyWithOs)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-md border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-3 text-xs text-[var(--text-muted)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
            <span>
              {isDeployMode
                ? "This plan comes straight from the admin catalog and deploys with its fixed resources."
                : "Your custom cloud instance pricing uses the current admin-managed rates and limits."}
            </span>
          </div>

          <div className="mt-4 grid gap-2">
            <input className="h-10 w-full rounded-md border border-[var(--border-primary)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-[3px] focus:ring-[rgba(20,184,166,0.12)]" value={hostname} onFocus={() => focusDraftField("hostname")} onBlur={() => blurDraftField("hostname")} onChange={(e) => { markDraftEdited(); setHostname(e.target.value) }} placeholder="Instance name (e.g. webserver)" />
            <input className="h-10 w-full rounded-md border border-[var(--border-primary)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]" value="root" readOnly placeholder="Admin user" />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type={showPassword ? "text" : "password"} className="h-10 w-full rounded-md border border-[var(--border-primary)] bg-[var(--surface-subtle)] px-3 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-[3px] focus:ring-[rgba(20,184,166,0.12)]" value={password} onFocus={() => focusDraftField("password")} onBlur={() => blurDraftField("password")} onChange={(e) => { markDraftEdited(); setPassword(e.target.value) }} placeholder="Password (8+ chars)" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="button" variant="outline" onClick={generatePassword}>Generate</Button>
              <Button type="button" variant="outline" size="icon" onClick={() => void copyPassword()} disabled={!password} aria-label="Copy password"><Copy className="h-4 w-4" /></Button>
            </div>
            <div className="grid gap-1.5 rounded-lg border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
              {passwordRequirements.map((item) => (
                <span key={item.label} className={`flex items-center gap-1.5 ${item.met ? "text-emerald-300" : ""}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <Button
              type="button"
              onClick={handleOrder}
              disabled={submitting || !selectedProduct || operatingSystemsLoading || operatingSystems.length === 0 || !operatingSystemId}
              className="w-full gap-1.5"
            >
              {submitting ? (
                <>
                  <Spinner className="size-4" />
                  Processing
                </>
              ) : (
                <>
                  {isDeployMode ? "Proceed to Payment" : "Save Config & Continue"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <Button type="button" variant="outline" asChild className="w-full">
              <a href="/contact">Request a Tailored Quote</a>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          Quote updates live as you adjust your build.
        </div>
      </aside>
    </div>
    </>
  )
}

function SliderRow({
  icon: Icon,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
}: {
  icon: typeof Cpu
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number[]) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-accent" />
          {label}
        </div>
        <div className="font-mono text-sm text-foreground">
          {value} {unit}
        </div>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={onChange} disabled={disabled} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

function SelectField({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  wide = false,
  disabled = false,
}: {
  icon: typeof Globe
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string; meta?: string }>
  wide?: boolean
  disabled?: boolean
}) {
  const showBadge = label === "Operating System"
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-accent" />
        {label}
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center justify-between gap-3">
                <span>{option.label}</span>
                {showBadge && option.meta ? (
                  <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {String(option.meta).toLowerCase().includes("win") ? "Windows" : "Linux"}
                  </span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right text-foreground">{v}</dd>
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
