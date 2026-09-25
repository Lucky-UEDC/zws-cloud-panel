"use client"

import { useState } from "react"
import { Activity, ShoppingCart, CreditCard, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

type Order = {
  id: string
  orderNumber: string
  status: string
  totalAmount: number
  createdAt: string
}

type Payment = {
  id: string
  amount: number
  status: string
  paymentMethod: string | null
  createdAt: string
}

type AnalyticsEvent = {
  id: string
  eventType: string
  eventName: string
  createdAt: string
  properties: Record<string, unknown>
}

type Tab = "orders" | "payments" | "events"

export function AdminRecentActivity({
  orders,
  payments,
  events,
}: {
  orders: Order[]
  payments: Payment[]
  events: AnalyticsEvent[]
}) {
  const [activeTab, setActiveTab] = useState<Tab>("orders")

  const tabs = [
    { id: "orders" as const, label: "Orders", icon: ShoppingCart, count: orders.length },
    { id: "payments" as const, label: "Payments", icon: CreditCard, count: payments.length },
    { id: "events" as const, label: "Events", icon: Activity, count: events.length },
  ]

  function formatTime(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getStatusColor(status: string) {
    switch (status.toLowerCase()) {
      case "completed":
      case "paid":
        return "text-emerald-400 bg-emerald-400/10"
      case "pending":
        return "text-amber-400 bg-amber-400/10"
      case "failed":
      case "cancelled":
        return "text-red-400 bg-red-400/10"
      default:
        return "text-muted-foreground bg-muted/30"
    }
  }

  return (
    <div className="glass rounded-xl p-5">
      <h2 className="text-lg font-semibold">Recent Activity</h2>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 rounded-lg bg-muted/30 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && (
              <span className="rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-selected)]">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-4 space-y-2">
        {activeTab === "orders" && (
          orders.length === 0 ? (
            <EmptyState message="No orders yet" />
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-lg bg-muted/20 p-3"
              >
                <div>
                  <p className="font-medium">{order.orderNumber}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(order.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">
                    ₹{Number(order.totalAmount).toLocaleString("en-IN")}
                  </p>
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[10px] uppercase",
                      getStatusColor(order.status)
                    )}
                  >
                    {order.status}
                  </span>
                </div>
              </div>
            ))
          )
        )}

        {activeTab === "payments" && (
          payments.length === 0 ? (
            <EmptyState message="No payments yet" />
          ) : (
            payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between rounded-lg bg-muted/20 p-3"
              >
                <div>
                  <p className="font-medium">
                    {payment.paymentMethod || "Payment"}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(payment.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">
                    ₹{Number(payment.amount).toLocaleString("en-IN")}
                  </p>
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[10px] uppercase",
                      getStatusColor(payment.status)
                    )}
                  >
                    {payment.status}
                  </span>
                </div>
              </div>
            ))
          )
        )}

        {activeTab === "events" && (
          events.length === 0 ? (
            <EmptyState message="No events recorded" />
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between rounded-lg bg-muted/20 p-3"
              >
                <div>
                  <p className="font-medium">{event.eventName.replace(/_/g, " ")}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(event.createdAt)}
                  </p>
                </div>
                <span className="rounded-full bg-muted/30 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {event.eventType}
                </span>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Activity className="h-8 w-8 text-muted-foreground/50" />
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
