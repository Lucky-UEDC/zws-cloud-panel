import Link from "next/link"
import { 
  Plus, 
  UserPlus, 
  FileText, 
  Settings,
  ArrowRight 
} from "lucide-react"

const actions = [
  {
    label: "Add New Product",
    description: "Create a new compute instance package or plan",
    href: "/admin/products/new",
    icon: Plus,
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
  },
  {
    label: "Add Customer",
    description: "Register a new customer manually",
    href: "/admin/customers/new",
    icon: UserPlus,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
  },
  {
    label: "Create Invoice",
    description: "Generate a new invoice",
    href: "/admin/invoices/new",
    icon: FileText,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
  },
  {
    label: "System Settings",
    description: "Configure pricing and preferences",
    href: "/admin/settings",
    icon: Settings,
    color: "text-accent",
    bgColor: "bg-[var(--accent-subtle)]",
  },
]

export function AdminQuickActions() {
  return (
    <div className="glass rounded-xl p-5">
      <h2 className="text-lg font-semibold">Quick Actions</h2>
      <div className="mt-4 space-y-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex items-center justify-between rounded-lg bg-muted/20 p-4 transition-all hover:bg-muted/30"
          >
            <div className="flex items-center gap-4">
              <div className={`rounded-lg p-2.5 ${action.bgColor}`}>
                <action.icon className={`h-5 w-5 ${action.color}`} />
              </div>
              <div>
                <p className="font-medium">{action.label}</p>
                <p className="text-sm text-muted-foreground">
                  {action.description}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>
    </div>
  )
}
