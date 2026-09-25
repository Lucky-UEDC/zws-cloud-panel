"use client"

import Link from "next/link"
import { Check, ArrowRight, Clock } from "lucide-react"
import type { Plan } from "@/lib/data/plans"
import { getPlanPrice, getPlanSavings } from "@/lib/data/plans"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatPrice, formatHourlyPrice, getTermLabel, type BillingTerm } from "@/lib/pricing"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"

interface PlanCardProps {
  plan: Plan
  term?: BillingTerm
  ctaHref?: string
  showHourly?: boolean
}

export function PlanCard({
  plan,
  term = 1,
  ctaHref,
  showHourly = true,
}: PlanCardProps) {
  const monthlyPrice = getPlanPrice(plan, term)
  const savings = getPlanSavings(plan, term)

  return (
    <div
      className={cn(
        "glass glass-hover relative flex flex-col rounded-2xl p-6",
        plan.popular && "accent-glow ring-1 ring-accent/30"
      )}
    >
      {plan.popular && (
        <div className="absolute -top-3 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground shadow-lg shadow-accent/30">
          Most popular
        </div>
      )}

      {/* Header */}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
        {plan.tier === "enterprise" && (
          <span className="rounded-md border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-selected)]">
            Enterprise
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      {/* Price */}
      <div className="mt-6">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight">
            {formatPrice(monthlyPrice)}
          </span>
          <span className="text-sm text-muted-foreground">/mo</span>
        </div>
        
        {/* Savings & Hourly */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {showHourly && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatHourlyPrice(plan.priceHourly)}
            </span>
          )}
          {savings > 0 && (
            <span className="rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-2 py-0.5 text-[var(--text-selected)]">
              Save {savings}% with {getTermLabel(term)}
            </span>
          )}
        </div>
      </div>

      {/* Specs */}
      <div className="mt-6 rounded-xl bg-foreground/[0.05] p-5 backdrop-blur-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Spec label="vCPU" value={`${plan.vcpu} cores`} />
          <Spec label="RAM" value={`${plan.ramGB} GB`} />
          <Spec label="NVMe Storage" value={`${plan.storageGB} GB`} />
          <Spec label="Included Bandwidth" value={formatBandwidthQuota(plan.bandwidthTB)} />
          <Spec label="Network Fabric" value="Up to 1.8 Tbps aggregate" />
        </dl>
      </div>

      {/* Features */}
      <ul className="mt-5 flex flex-col gap-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-8 flex flex-col gap-2">
        <Button
          asChild
          variant={plan.popular ? "default" : "outline"}
          className="w-full gap-1.5"
        >
          <Link href={ctaHref ?? "/pricing"}>
            Deploy Now
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </dt>
      <dd className="mt-2 text-lg font-bold leading-tight text-foreground">
        {value}
      </dd>
    </div>
  )
}
