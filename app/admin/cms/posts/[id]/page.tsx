import { CmsPostForm } from "@/components/admin/cms-post-form"

export default async function EditCmsPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CmsPostForm postId={id} />
}
