import { CatalogListingPage } from "@/components/catalog/catalog-listing-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

type Props = {
  params: Promise<{ categorySlug: string }>
}

export default async function DynamicCategoryPage({ params }: Props) {
  const { categorySlug } = await params
  return <CatalogListingPage categorySlug={categorySlug} />
}
