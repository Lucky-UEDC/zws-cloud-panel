import { getBrandSettings, getSetting, type GeneralSettings } from "@/lib/settings"
import { configuredSiteDomain, publicOrigin } from "@/lib/public-url"

const FALLBACK_BRAND_NAME = process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud"
const FALLBACK_LEGAL_COMPANY_NAME = process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME || process.env.LEGAL_COMPANY_NAME || `${FALLBACK_BRAND_NAME} Services`

function fallbackSupportEmail() {
  const domain = configuredSiteDomain()
  return domain ? `support@${domain}` : "support@example.com"
}

function cleanText(value: unknown) {
  return String(value ?? "").trim()
}

function cleanSentence(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").replace(/[.。]+$/g, "")
}

function cleanUrl(value: unknown, fallback = "") {
  const raw = cleanText(value || fallback)
  if (!raw) return ""
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withProtocol.replace(/\/+$/g, "")
}

function cleanAssetUrl(value: unknown, fallback = "") {
  const raw = cleanText(value || fallback)
  if (!raw) return ""
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw
  return cleanUrl(raw)
}

function cleanEmail(value: unknown, fallback = "") {
  return cleanText(value || fallback).toLowerCase()
}

function cleanOptionalNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function splitSpecialties(value: unknown) {
  return cleanText(value)
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinAddress(general: GeneralSettings | null, fallback = "") {
  const structured = [
    general?.addressLine1,
    general?.addressLine2,
    general?.city,
    general?.state,
    general?.zipCode,
    general?.country,
  ].map(cleanText).filter(Boolean)
  return cleanText(general?.companyAddress) || structured.join(", ") || cleanText(fallback)
}

export type FounderSettings = {
  enabled: boolean
  visible: boolean
  name: string
  age: number | null
  photoUrl: string
  title: string
  experienceYears: number | null
  specialties: string[]
  shortBio: string
  longDescription: string
  linkedInUrl: string
  xUrl: string
  email: string
  location: string
}

export type SiteSettings = {
  companyName: string
  brandName: string
  legalCompanyName: string
  websiteName: string
  tagline: string
  registrationNumber: string
  companyEmail: string
  supportEmail: string
  billingEmail: string
  salesEmail: string
  abuseEmail: string
  companyPhone: string
  supportPhone: string
  whatsappNumber: string
  telegramUsername: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  zipCode: string
  country: string
  gstNumber: string
  vatNumber: string
  companyAddress: string
  footerDescription: string
  footerCopyrightText: string
  publicContactBox: string
  siteUrl: string
  clientAreaUrl: string
  logoUrl: string
  faviconUrl: string
  footerLogoUrl: string
  invoiceLogoUrl: string
  openGraphImageUrl: string
  facebookUrl: string
  instagramUrl: string
  twitterUrl: string
  telegramUrl: string
  whatsappLink: string
  discordUrl: string
  youtubeUrl: string
  metaTitle: string
  metaDescription: string
  metaKeywords: string
  googleAnalyticsId: string
  termsUrl: string
  privacyUrl: string
  refundPolicyUrl: string
  abusePolicyUrl: string
  currency: string
  aboutCompanyHeadline: string
  aboutCompanyDescription: string
  missionStatement: string
  visionStatement: string
  founder: FounderSettings
}

export type PublicSiteSettings = SiteSettings

function fallbackSiteUrl() {
  const origin = publicOrigin()
  if (origin) return origin
  const domain = configuredSiteDomain()
  return domain ? `https://${domain}` : "https://example.com"
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const [general, brand] = await Promise.all([
    getSetting<GeneralSettings>("general_settings").catch(() => null),
    getBrandSettings().catch(() => null),
  ])

  const brandName = cleanText(general?.brandName || brand?.brandName || brand?.appName || FALLBACK_BRAND_NAME) || FALLBACK_BRAND_NAME
  const companyName = cleanText(general?.companyName || brandName) || brandName
  const legalCompanyName = cleanText(general?.legalCompanyName || brand?.legalCompanyName || FALLBACK_LEGAL_COMPANY_NAME) || FALLBACK_LEGAL_COMPANY_NAME
  const websiteName = cleanText(general?.websiteName || brand?.websiteName || brandName) || brandName
  const siteUrl = cleanUrl(fallbackSiteUrl())
  const clientAreaUrl = `${siteUrl}/client-area`
  const supportEmail = cleanEmail(general?.supportEmail || brand?.supportEmail, fallbackSupportEmail()) || fallbackSupportEmail()
  const companyEmail = cleanEmail(general?.companyEmail, supportEmail) || supportEmail
  const billingEmail = cleanEmail(general?.billingEmail || brand?.billingEmail, supportEmail) || supportEmail
  const salesEmail = cleanEmail(general?.salesEmail || brand?.salesEmail, companyEmail) || companyEmail
  const abuseEmail = cleanEmail(general?.abuseEmail || brand?.abuseEmail, supportEmail) || supportEmail

  const founderName = cleanText(general?.founderName)
  const founder: FounderSettings = {
    enabled: Boolean(general?.founderEnabled),
    visible: Boolean(general?.founderEnabled && founderName),
    name: founderName,
    age: cleanOptionalNumber(general?.founderAge),
    photoUrl: cleanUrl(general?.founderPhotoUrl),
    title: cleanText(general?.founderTitle),
    experienceYears: cleanOptionalNumber(general?.founderExperienceYears),
    specialties: splitSpecialties(general?.founderSpecialties),
    shortBio: cleanText(general?.founderShortBio),
    longDescription: cleanText(general?.founderLongDescription),
    linkedInUrl: cleanUrl(general?.founderLinkedInUrl),
    xUrl: cleanUrl(general?.founderXUrl),
    email: cleanEmail(general?.founderEmail),
    location: cleanText(general?.founderLocation),
  }

  return {
    companyName,
    brandName,
    legalCompanyName,
    websiteName,
    tagline: cleanText(general?.tagline || brand?.tagline),
    registrationNumber: cleanText(general?.registrationNumber || brand?.registrationNumber),
    companyEmail,
    supportEmail,
    billingEmail,
    salesEmail,
    abuseEmail,
    companyPhone: cleanText(general?.companyPhone || general?.phoneNumber || brand?.phoneNumber),
    supportPhone: cleanText(general?.supportPhone || general?.companyPhone || general?.phoneNumber || brand?.phoneNumber),
    whatsappNumber: cleanText(general?.whatsappNumber || brand?.whatsappNumber),
    telegramUsername: cleanText(general?.telegramUsername || brand?.telegramUsername).replace(/^@/, ""),
    addressLine1: cleanText(general?.addressLine1),
    addressLine2: cleanText(general?.addressLine2),
    city: cleanText(general?.city),
    state: cleanText(general?.state),
    zipCode: cleanText(general?.zipCode),
    country: cleanText(general?.country),
    gstNumber: cleanText(general?.gstNumber || brand?.gstNumber),
    vatNumber: cleanText(general?.vatNumber || brand?.vatNumber),
    companyAddress: joinAddress(general, brand?.companyAddress),
    footerDescription: cleanSentence(general?.footerDescription || brand?.footerDescription || "Professional cloud infrastructure and compute automation."),
    footerCopyrightText: cleanText(general?.footerCopyrightText || brand?.footerCopyrightText),
    publicContactBox: cleanText(general?.publicContactBox || brand?.publicContactBox),
    siteUrl,
    clientAreaUrl,
    logoUrl: cleanAssetUrl(brand?.logoUrl || general?.logoUrl),
    faviconUrl: cleanAssetUrl(brand?.faviconUrl),
    footerLogoUrl: cleanAssetUrl(brand?.footerLogoUrl || general?.footerLogoUrl || brand?.logoUrl || general?.logoUrl),
    invoiceLogoUrl: cleanAssetUrl(brand?.invoiceLogoUrl || general?.invoiceLogoUrl || brand?.logoUrl || general?.logoUrl),
    openGraphImageUrl: cleanAssetUrl(brand?.openGraphImageUrl || general?.openGraphImageUrl || brand?.logoUrl || general?.logoUrl),
    facebookUrl: cleanUrl(general?.facebookUrl),
    instagramUrl: cleanUrl(general?.instagramUrl),
    twitterUrl: cleanUrl(general?.twitterUrl),
    telegramUrl: cleanUrl(general?.telegramUrl),
    whatsappLink: cleanUrl(general?.whatsappLink),
    discordUrl: cleanUrl(general?.discordUrl),
    youtubeUrl: cleanUrl(general?.youtubeUrl),
    metaTitle: cleanText(general?.metaTitle || general?.defaultMetaTitle),
    metaDescription: cleanText(general?.metaDescription || general?.defaultMetaDescription),
    metaKeywords: cleanText(general?.metaKeywords),
    googleAnalyticsId: cleanText(general?.googleAnalyticsId),
    termsUrl: cleanUrl(general?.termsUrl || general?.tosUrl, `${siteUrl}/legal/terms`),
    privacyUrl: cleanUrl(general?.privacyUrl, `${siteUrl}/legal/privacy`),
    refundPolicyUrl: cleanUrl(general?.refundPolicyUrl || general?.refundUrl, `${siteUrl}/legal/refund`),
    abusePolicyUrl: cleanUrl(general?.abusePolicyUrl, `${siteUrl}/legal/aup`),
    currency: "INR",
    aboutCompanyHeadline: cleanText(general?.aboutCompanyHeadline) || `${brandName} is building reliable cloud infrastructure for teams that need predictable operations.`,
    aboutCompanyDescription: cleanText(general?.aboutCompanyDescription) || `${brandName} focuses on stable compute, transparent pricing, and responsive support for production workloads.`,
    missionStatement: cleanText(general?.missionStatement),
    visionStatement: cleanText(general?.visionStatement),
    founder,
  }
}

export async function getPublicSiteSettings(): Promise<PublicSiteSettings> {
  return getSiteSettings()
}

export async function getBrandName() {
  return (await getSiteSettings()).brandName
}

export async function getLegalCompanyName() {
  return (await getSiteSettings()).legalCompanyName
}

export async function getSupportEmail() {
  return (await getSiteSettings()).supportEmail
}

export async function getBillingEmail() {
  return (await getSiteSettings()).billingEmail
}

export async function getSiteUrl() {
  return (await getSiteSettings()).siteUrl
}

export async function getClientAreaUrl() {
  return (await getSiteSettings()).clientAreaUrl
}

export async function getCurrency() {
  return (await getSiteSettings()).currency
}

export async function getFounderSettings() {
  return (await getSiteSettings()).founder
}
