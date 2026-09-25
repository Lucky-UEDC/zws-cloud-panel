"use client"

import { adminApiErrorMessage, adminApiJson } from "@/lib/client/admin-api"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, Pencil, RefreshCw, Trash2 } from "lucide-react"

type Product = {
  id: string
  name: string
  slug: string
  type: string
  status: string
  visibility: string
  deletedAt?: string | null
  isActive: boolean
  isFeatured: boolean
  ctaMode: string
  price1m: number
  categoryRef?: { title: string } | null
  subcategoryRef?: { title: string } | null
}

type SyncResult = {
  synced: number
  updated: number
  newPlans: number
  skipped: boolean
  reason?: string
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [typeFilter, setTypeFilter] = useState("all")
  const [stateFilter, setStateFilter] = useState("all")
  const [visibilityFilter, setVisibilityFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [subcategoryFilter, setSubcategoryFilter] = useState("all")
  const [ctaFilter, setCtaFilter] = useState("all")
  const [lifecycleFilter, setLifecycleFilter] = useState("active")
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const params = new URLSearchParams()
    if (lifecycleFilter !== "all") params.set("state", lifecycleFilter)
    try {
      const data = await adminApiJson<{ products?: Product[] }>(`/api/admin/products${params.size ? `?${params.toString()}` : "?state=all"}`)
      setProducts(Array.isArray(data.products) ? data.products : [])
    } catch (error) {
      const message = adminApiErrorMessage(error, "Failed to load products")
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [lifecycleFilter])

  const runSync = useCallback(async (trigger: "auto" | "manual") => {
    if (syncing) return
    setSyncing(true)
    try {
      const data = await adminApiJson<{ result?: SyncResult }>('/api/admin/products/sync', {
        method: 'POST',
        body: JSON.stringify({ trigger }),
      })
      const result = data.result
      if (!result) throw new Error("Product sync returned no result")
      if (!result.skipped || trigger === 'manual') {
        toast.success(`${result.synced} plans synced, ${result.updated} updated, ${result.newPlans} new`)
      }
      await load()
    } catch (error) {
      if (trigger === "manual") toast.error(adminApiErrorMessage(error, "Failed to sync plans"))
    } finally {
      setSyncing(false)
    }
  }, [load, syncing])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("zws-admin-products") : null
    const reload = () => void load()
    channel?.addEventListener("message", reload)
    const onStorage = (event: StorageEvent) => {
      if (event.key === "zws-admin-products-sync") reload()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      channel?.close()
      window.removeEventListener("storage", onStorage)
    }
  }, [load])

  async function deleteProduct(id: string) {
    try {
      await adminApiJson(`/api/admin/products/${id}`, { method: "DELETE" })
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "Failed to delete product"))
      return
    }
    toast.success("Product deleted")
    setProducts((current) => lifecycleFilter === "all" || lifecycleFilter === "deleted"
      ? current.map((product) => product.id === id ? { ...product, deletedAt: new Date().toISOString(), status: "deleted", isActive: false, visibility: "hidden" } : product)
      : current.filter((product) => product.id !== id))
    await load()
  }

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const deleted = Boolean(product.deletedAt) || String(product.status || "").toLowerCase() === "deleted"
      if (lifecycleFilter === "active" && (deleted || !product.isActive)) return false
      if (lifecycleFilter === "deleted" && !deleted) return false
      if (typeFilter !== "all" && product.type !== typeFilter) return false
      if (stateFilter === "featured" && !product.isFeatured) return false
      if (stateFilter === "active" && !product.isActive) return false
      if (stateFilter === "inactive" && product.isActive) return false
      if (visibilityFilter !== "all" && product.visibility !== visibilityFilter) return false
      if (categoryFilter !== "all" && (product.categoryRef?.title || "").toLowerCase() !== categoryFilter.toLowerCase()) return false
      if (subcategoryFilter !== "all" && (product.subcategoryRef?.title || "").toLowerCase() !== subcategoryFilter.toLowerCase()) return false
      if (ctaFilter !== "all" && String(product.ctaMode || "") !== ctaFilter) return false
      return true
    })
  }, [products, lifecycleFilter, typeFilter, stateFilter, visibilityFilter, categoryFilter, subcategoryFilter, ctaFilter])

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.categoryRef?.title).filter(Boolean) as string[])],
    [products],
  )
  const subcategories = useMemo(
    () => [...new Set(products.map((product) => product.subcategoryRef?.title).filter(Boolean) as string[])],
    [products],
  )
  const grouped = useMemo(
    () => ({
      fixed: filtered.filter((product) => product.type === "fixed_vps"),
      configurable: filtered.filter((product) => product.type === "configurable"),
      dedicated: filtered.filter((product) => product.type === "dedicated"),
    }),
    [filtered],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Products</h1>
          <p className="text-muted-foreground">Manage fixed plans, configurable products, and service catalog items from one system.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => runSync('manual')} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? 'Syncing...' : 'Sync Plans'}
          </Button>
          <Button asChild><Link href="/admin/products/new">Add Product</Link></Button>
        </div>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter products by family, status, and visibility.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All types</option>
            <option value="fixed_vps">Fixed VPS</option>
            <option value="configurable">Configurable</option>
            <option value="dedicated">Dedicated</option>
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="featured">Featured</option>
          </select>
          <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All visibility</option>
            <option value="public">Public</option>
            <option value="hidden">Hidden</option>
            <option value="private">Private</option>
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={subcategoryFilter} onChange={(e) => setSubcategoryFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All subcategories</option>
            {subcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
          </select>
          <select value={ctaFilter} onChange={(e) => setCtaFilter(e.target.value)} className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All CTA modes</option>
            <option value="purchase_now">Purchase Now</option>
            <option value="configure">Configure</option>
            <option value="contact_sales">Contact Sales</option>
          </select>
          <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)} className="ml-auto h-9 rounded-md border border-border/40 bg-background px-3 text-sm">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="deleted">Deleted</option>
          </select>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Product Catalog</CardTitle></CardHeader>
        <CardContent>
          {loadError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
              <div>
                <p className="font-medium">Products could not be loaded.</p>
                <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => load()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading products...</p>
          ) : (
            <>
              <FamilyTable title="Fixed Cloud Instance Plans" rows={grouped.fixed} deleteProduct={deleteProduct} />
              <FamilyTable title="Configurable Builder" rows={grouped.configurable} deleteProduct={deleteProduct} />
              <FamilyTable title="Dedicated Servers / BMS" rows={grouped.dedicated} deleteProduct={deleteProduct} />
              {!filtered.length ? <p className="py-8 text-center text-muted-foreground">No products found.</p> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FamilyTable({
  title,
  rows,
  deleteProduct,
}: {
  title: string
  rows: Product[]
  deleteProduct: (id: string) => Promise<void>
}) {
  return (
    <div className="mb-7 overflow-hidden rounded-lg border border-border/30">
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/15 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <Badge variant="outline">{rows.length} products</Badge>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="border-b border-border/40 text-left text-muted-foreground">
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              deleteProduct={deleteProduct}
            />
          ))}
          {!rows.length ? <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No products in this family.</td></tr> : null}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function ProductRow({
  product,
  deleteProduct,
}: {
  product: Product
  deleteProduct: (id: string) => Promise<void>
}) {
  const deleted = Boolean(product.deletedAt) || String(product.status || "").toLowerCase() === "deleted"

  return (
            <tr className="group border-b border-border/20 transition hover:bg-[rgba(255,255,255,0.04)]">
              <td className="px-4 py-4">
                <p className="font-semibold tracking-tight transition-colors group-hover:text-[var(--text-primary)]">{product.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{product.slug}</p>
              </td>
              <td className="px-4 py-4"><TypeBadge type={product.type} /></td>
              <td className="px-4 py-4">
                <p className="font-medium">{product.categoryRef?.title || "Unassigned"}</p>
                {product.subcategoryRef?.title ? <p className="text-xs text-muted-foreground">{product.subcategoryRef.title}</p> : null}
              </td>
              <td className="px-4 py-4">
                <p className="text-xl font-semibold tabular-nums">₹{Number(product.price1m).toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">monthly base</p>
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-1.5">
                  <ProductStatusBadge product={product} />
                  {product.isFeatured ? <Badge className="border-purple-400/40 bg-purple-400/10 text-purple-200 hover:bg-purple-400/15">featured</Badge> : null}
                  <CtaBadge mode={product.ctaMode || "purchase_now"} />
                </div>
              </td>
              <td className="px-4 py-4">
                <div className="flex justify-end gap-1.5">
                  {!deleted ? <Button asChild variant="outline" size="sm" title="Edit product"><Link href={`/admin/products/${product.id}`}><Pencil className="mr-2 h-4 w-4" />Edit</Link></Button> : null}
                  {!deleted ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" title="Delete product">
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteProduct(product.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </td>
            </tr>
  )
}

function TypeBadge({ type }: { type: string }) {
  return <Badge variant="outline" className="uppercase tracking-wide">{type.replace(/_/g, " ")}</Badge>
}

function ProductStatusBadge({ product }: { product: Product }) {
  const deleted = Boolean(product.deletedAt) || String(product.status || "").toLowerCase() === "deleted"
  if (deleted) return <Badge className="border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/15">deleted</Badge>
  if (!product.isActive || String(product.status || "").toLowerCase() === "draft") return <Badge className="border-gray-400/40 bg-gray-400/10 text-gray-200 hover:bg-gray-400/15">draft</Badge>
  return <Badge className="border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15">active</Badge>
}

function CtaBadge({ mode }: { mode: string }) {
  if (mode === "purchase_now") return <Badge className="border-[var(--border-selected)] bg-[var(--accent-subtle)] text-[var(--text-selected)] hover:bg-[var(--accent-hover-soft)]">purchase_now</Badge>
  return <Badge variant="outline">{mode}</Badge>
}
