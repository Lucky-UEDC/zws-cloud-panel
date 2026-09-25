import { CmsSimpleManager } from "@/components/admin/cms-simple-manager"

export default function CmsCategoriesPage() {
  return <CmsSimpleManager title="Blog Categories" description="Manage article categories and category SEO metadata." endpoint="/api/admin/cms/categories" itemKey="categories" />
}
