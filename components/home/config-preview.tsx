"use client"

import Link from "next/link"
import { ArrowRight, Cpu, MemoryStick, HardDrive, CalendarClock } from "lucide-react"
import { useMemo, useState } from "react"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { billingCycleMultiplier, type BillingCycle } from "@/lib/data/plans"
import { formatCurrency } from "@/lib/currency-format"

export function ConfigPreview() {
  const [cpu, setCpu] = useState<number[]>([4])
  const [ram, setRam] = useState<number[]>([8])
  const [storage, setStorage] = useState<number[]>([160])
  const [cycle, setCycle] = useState<BillingCycle>("monthly")

  const basePerMonth = useMemo(() => {
    // Simple origin-market demo pricing formula.
    return cpu[0] * 250 + ram[0] * 60 + storage[0] * 4
  }, [cpu, ram, storage])

  const total = Math.round(basePerMonth * billingCycleMultiplier[cycle])
  const perMonth = Math.round(total / (cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : 12))

  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow="Custom configuration"
          title="Build the server you actually need"
          description="Adjust vCPU, RAM, NVMe storage, and bandwidth. Get a live quote. Deploy when you're ready."
        />

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-8">
              <ConfigSlider
                icon={Cpu}
                label="vCPU"
                unit="cores"
                value={cpu[0]}
                min={1}
                max={32}
                step={1}
                onChange={setCpu}
              />
              <ConfigSlider
                icon={MemoryStick}
                label="Memory"
                unit="GB"
                value={ram[0]}
                min={2}
                max={128}
                step={2}
                onChange={setRam}
              />
              <ConfigSlider
                icon={HardDrive}
                label="Storage"
                unit="GB NVMe"
                value={storage[0]}
                min={40}
                max={1000}
                step={20}
                onChange={setStorage}
              />

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CalendarClock className="h-4 w-4 text-accent" />
                  Billing cycle
                </div>
                <RadioGroup
                  value={cycle}
                  onValueChange={(v) => setCycle(v as BillingCycle)}
                  className="grid grid-cols-3 gap-2"
                >
                  {(["monthly", "quarterly", "annual"] as BillingCycle[]).map(
                    (c) => (
                      <Label
                        key={c}
                        htmlFor={`cycle-${c}`}
                        className="glass flex cursor-pointer items-center justify-center rounded-lg px-3 py-2 text-sm capitalize text-muted-foreground transition-colors hover:text-foreground has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:text-foreground"
                      >
                        <RadioGroupItem
                          id={`cycle-${c}`}
                          value={c}
                          className="sr-only"
                        />
                        {c}
                        {c === "quarterly" && (
                          <span className="ml-1 text-xs text-accent">−5%</span>
                        )}
                        {c === "annual" && (
                          <span className="ml-1 text-xs text-accent">−17%</span>
                        )}
                      </Label>
                    )
                  )}
                </RadioGroup>
              </div>
            </div>
          </div>

          <aside className="glass glass-strong flex flex-col rounded-2xl p-6 sm:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Live quote
            </h3>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">
                {formatCurrency(total, "INR")}
              </span>
              <span className="text-sm text-muted-foreground">
                /{cycle === "monthly" ? "mo" : cycle === "quarterly" ? "quarter" : "yr"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              ≈ {formatCurrency(perMonth, "INR")}/mo effective
            </p>

            <dl className="mt-6 flex flex-col gap-3 pt-5 text-sm">
              <Row k="vCPU" v={`${cpu[0]} cores`} />
              <Row k="Memory" v={`${ram[0]} GB`} />
              <Row k="Storage" v={`${storage[0]} GB NVMe`} />
              <Row k="Bandwidth" v="Predictable traffic quota included" />
              <Row k="Network fabric" v="Up to 1.8 Tbps aggregate" />
            </dl>

            <div className="mt-8 flex flex-col gap-2">
              <Button asChild className="w-full gap-1.5">
                <Link
                  href={`/configure?cpu=${cpu[0]}&ram=${ram[0]}&storage=${storage[0]}&cycle=${cycle}`}
                >
                  Continue to configurator
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/contact">Request a custom quote</Link>
              </Button>
            </div>
          </aside>
        </div>
      </Container>
    </section>
  )
}

function ConfigSlider({
  icon: Icon,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  icon: typeof Cpu
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number[]) => void
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
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={onChange}
        aria-label={label}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  )
}
