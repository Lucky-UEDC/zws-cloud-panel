import { NextRequest, NextResponse } from "next/server"
import { completeCloudflareOAuth } from "@/lib/cloudflare-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectUrl(request: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/admin/system/cloudflare", request.url)
  url.searchParams.set(status, "1")
  if (message) url.searchParams.set("message", message.slice(0, 180))
  return url
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || ""
  const state = request.nextUrl.searchParams.get("state") || ""
  if (!code || !state) {
    return NextResponse.redirect(redirectUrl(request, "error", "Missing Cloudflare OAuth code or state."))
  }
  try {
    await completeCloudflareOAuth(request, code, state)
    return NextResponse.redirect(redirectUrl(request, "connected"))
  } catch (error: any) {
    return NextResponse.redirect(redirectUrl(request, "error", error?.message || "Cloudflare OAuth failed."))
  }
}
