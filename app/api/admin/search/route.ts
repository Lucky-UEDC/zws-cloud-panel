import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminPath } from "@/lib/admin-rbac"
import { validateSecurityField, escapeSerializable } from "@/lib/security/input"
import { securityGate } from "@/lib/security/forms"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function GET(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  const qRaw = String(request.nextUrl.searchParams.get("q") || "").trim()
  const qResult = validateSecurityField(qRaw, "search", "Search")
  if (!qResult.ok) {
    if (qResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, qResult.detection, "q")
    return NextResponse.json({ ok: false, error: "Invalid search query" }, { status: 400 })
  }
  const q = qResult.value
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] })
  const contains = { contains: q, mode: "insensitive" as const }
  const [customers, orders, posts, tags, invoices, logs] = await Promise.all([
    canAccessAdminPath(admin.role, "/admin/customers") ? prisma.customer.findMany({ where: { OR: [{ email: contains }, { name: contains }, { phone: contains }] }, select: { id: true, email: true, name: true }, take: 5 }).catch(() => []) : [],
    canAccessAdminPath(admin.role, "/admin/orders") ? (prisma as any).order.findMany({ where: { OR: [{ id: contains }, { customerEmail: contains }, { orderNumber: contains }] }, select: { id: true, orderNumber: true, customerEmail: true }, take: 5 }).catch(() => []) : [],
    canAccessAdminPath(admin.role, "/admin/cms/posts") ? (prisma as any).blogPost.findMany({ where: { OR: [{ title: contains }, { slug: contains }] }, select: { id: true, title: true, slug: true }, take: 5 }).catch(() => []) : [],
    canAccessAdminPath(admin.role, "/admin/cms/tags") ? (prisma as any).cmsTag.findMany({ where: { OR: [{ name: contains }, { slug: contains }] }, select: { id: true, name: true, slug: true }, take: 5 }).catch(() => []) : [],
    canAccessAdminPath(admin.role, "/admin/invoices") ? (prisma as any).invoice.findMany({ where: { OR: [{ invoiceNumber: contains }, { customerEmail: contains }] }, select: { id: true, invoiceNumber: true, customerEmail: true }, take: 5 }).catch(() => []) : [],
    canAccessAdminPath(admin.role, "/admin/logs") ? prisma.panelLog.findMany({ where: { OR: [{ message: contains }, { actorEmail: contains }, { category: contains }] }, select: { id: true, message: true, category: true }, take: 5 }).catch(() => []) : [],
  ])
  const results = [
    ...customers.map((item) => ({ type: "Customer", title: item.name || item.email, subtitle: item.email, href: `/admin/customers/${item.id}` })),
    ...orders.map((item: any) => ({ type: "Order", title: item.orderNumber || item.id, subtitle: item.customerEmail, href: "/admin/orders" })),
    ...posts.map((item: any) => ({ type: "Blog post", title: item.title, subtitle: `/${item.slug}`, href: `/admin/cms/posts/${item.id}` })),
    ...tags.map((item: any) => ({ type: "Tag", title: item.name, subtitle: `/${item.slug}`, href: "/admin/cms/tags" })),
    ...invoices.map((item: any) => ({ type: "Invoice", title: item.invoiceNumber || item.id, subtitle: item.customerEmail, href: "/admin/invoices" })),
    ...logs.map((item) => ({ type: "Log", title: item.message, subtitle: item.category, href: "/admin/logs" })),
  ].slice(0, 12)
  return NextResponse.json({ ok: true, results: escapeSerializable(results) })
}
