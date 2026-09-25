import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const response = await fetch(new URL("/api/client/wallet/topup", request.url), {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/json",
      cookie: request.headers.get("cookie") || "",
    },
    body: await request.text(),
  })
  const body = await response.text()
  return new NextResponse(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  })
}
