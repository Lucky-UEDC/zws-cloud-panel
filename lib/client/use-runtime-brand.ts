"use client"

import { useEffect, useState } from "react"

export type RuntimeBrand = {
  appName: string
  brandName: string
  legalCompanyName: string
  siteUrl: string
  clientAreaUrl: string
  supportEmail: string
  billingEmail: string
  abuseEmail?: string
  supportPhone?: string
  whatsappNumber?: string
  telegramUsername?: string
  companyAddress?: string
  logoUrl: string
  faviconUrl?: string
  footerLogoUrl?: string
  invoiceLogoUrl?: string
  openGraphImageUrl?: string
  footerDescription: string
  footerCopyrightText?: string
  publicContactBox?: string
  social?: Record<string, string>
  primaryColor?: string
}

const fallbackBrand: RuntimeBrand = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Cloud",
  brandName: process.env.NEXT_PUBLIC_APP_NAME || "Cloud",
  legalCompanyName: process.env.NEXT_PUBLIC_APP_NAME || "Cloud",
  siteUrl: "",
  clientAreaUrl: "",
  supportEmail: "",
  billingEmail: "",
  logoUrl: "",
  faviconUrl: "",
  footerDescription: "",
  primaryColor: "",
}

export function useRuntimeBrand() {
  const [brand, setBrand] = useState<RuntimeBrand>(fallbackBrand)

  useEffect(() => {
    let active = true
    fetch("/api/runtime/brand", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!active || !data?.brand) return
        setBrand({ ...fallbackBrand, ...data.brand })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return brand
}
