import { CatalogListingPage } from "@/components/catalog/catalog-listing-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

type Props = {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>
}

export default async function DynamicSubcategoryPage({ params }: Props) {
  const { categorySlug, subcategorySlug } = await params
  return <CatalogListingPage categorySlug={categorySlug} subcategorySlug={subcategorySlug} />
}
