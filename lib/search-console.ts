import { SignJWT, importPKCS8 } from "jose"
import { getServiceIntegrationConfig } from "@/lib/integration-config"

type SearchConsoleRow = {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

function date(daysAgo: number) {
  const value = new Date(Date.now() - daysAgo * 86400_000)
  return value.toISOString().slice(0, 10)
}

async function accessToken(serviceAccountJson: string) {
  const account = JSON.parse(serviceAccountJson)
  const email = String(account.client_email || "")
  const privateKey = String(account.private_key || "")
  if (!email || !privateKey) throw new Error("Search Console service account is incomplete.")
  const key = await importPKCS8(privateKey, "RS256")
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key)
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Search Console token failed: ${response.status}`)
  const body = await response.json()
  return String(body.access_token || "")
}

async function query(siteUrl: string, token: string, dimensions: string[]) {
  const response = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: date(28), endDate: date(1), dimensions, rowLimit: 25 }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Search Console query failed: ${response.status}`)
  return await response.json() as { rows?: SearchConsoleRow[] }
}

export async function getSearchConsoleSummary() {
  const config = await getServiceIntegrationConfig("googleSearchConsole")
  const siteUrl = String(config.siteUrl || "")
  const serviceAccountJson = String(config.serviceAccountJson || "")
  if (!siteUrl || !serviceAccountJson || /^\*+$/.test(serviceAccountJson)) {
    return { configured: false, keywords: [], topPages: [], totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }
  }
  const token = await accessToken(serviceAccountJson)
  const [keywordData, pageData] = await Promise.all([query(siteUrl, token, ["query"]), query(siteUrl, token, ["page"])])
  const keywords = (keywordData.rows || []).map((row) => ({
    keyword: row.keys?.[0] || "",
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: Number(((row.ctr || 0) * 100).toFixed(2)),
    position: Number((row.position || 0).toFixed(1)),
  }))
  const topPages = (pageData.rows || []).map((row) => ({
    page: row.keys?.[0] || "",
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: Number(((row.ctr || 0) * 100).toFixed(2)),
    position: Number((row.position || 0).toFixed(1)),
  }))
  const totals = keywords.reduce((acc, row) => ({
    clicks: acc.clicks + row.clicks,
    impressions: acc.impressions + row.impressions,
    ctr: acc.ctr,
    position: acc.position,
  }), { clicks: 0, impressions: 0, ctr: 0, position: 0 })
  totals.ctr = totals.impressions ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0
  totals.position = keywords.length ? Number((keywords.reduce((sum, row) => sum + row.position, 0) / keywords.length).toFixed(1)) : 0
  return { configured: true, keywords, topPages, totals }
}
