import { CmsSimpleManager } from "@/components/admin/cms-simple-manager"

export default function CmsTagsPage() {
  return <CmsSimpleManager title="Tag Manager" description="Create tags, manage SEO slugs, and track related posts." endpoint="/api/admin/cms/tags" itemKey="tags" />
}
