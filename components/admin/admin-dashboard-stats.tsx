import Link from "next/link"
import { Users, ShoppingCart, CreditCard, IndianRupee, Package, LifeBuoy } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

type Stats = {
  customers: number
  products: number
  orders: number
  payments: number
  revenue: number
  openTickets: number
}

export function AdminDashboardStats({ stats }: { stats: Stats }) {
  const statItems = [
    {
      label: "Total Customers",
      value: stats.customers.toLocaleString(),
      icon: Users,
      color: "text-blue-400",
      bgColor: "bg-blue-400/10",
      href: "/admin/customers",
    },
    {
      label: "Total Orders",
      value: stats.orders.toLocaleString(),
      icon: ShoppingCart,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
      href: "/admin/orders",
    },
    {
      label: "Active Products",
      value: stats.products.toLocaleString(),
      icon: Package,
      color: "text-indigo-400",
      bgColor: "bg-indigo-400/10",
      href: "/admin/products",
    },
    {
      label: "Completed Payments",
      value: stats.payments.toLocaleString(),
      icon: CreditCard,
      color: "text-amber-400",
      bgColor: "bg-amber-400/10",
      href: "/admin/payments",
    },
    {
      label: "Total Revenue",
      value: `₹${stats.revenue.toLocaleString("en-IN")}`,
      icon: IndianRupee,
      color: "text-accent",
      bgColor: "bg-[var(--accent-subtle)]",
      href: "/admin/revenue",
    },
    {
      label: "Open Tickets",
      value: stats.openTickets.toLocaleString(),
      icon: LifeBuoy,
      color: "text-rose-400",
      bgColor: "bg-rose-400/10",
      href: "/admin/support",
    },
  ]

  return (
    <div className="grid min-w-0 max-w-full gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {statItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-label={`Open ${item.label.toLowerCase()}`}
          className="group block min-w-0 max-w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Card className="glass h-full cursor-pointer border-border/40 py-0 transition-all duration-200 hover:scale-[1.02] hover:border-cyan-400/40 hover:bg-white/[0.03] hover:shadow-[0_0_34px_rgba(34,211,238,0.10)]">
            <CardContent className="p-5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground">{item.label}</span>
                <div className={`shrink-0 rounded-lg p-2 ${item.bgColor}`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
              </div>
              <p className="mt-3 truncate text-3xl font-semibold tabular-nums">{item.value}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
