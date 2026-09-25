export async function readJsonResponse<T = any>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") || ""
  const text = await response.text()
  let data: any = null

  if (text.trim()) {
    if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      console.error("[safe_json_html_response]", { status: response.status, url: response.url, preview: text.slice(0, 160) })
      throw new Error(`API returned HTML instead of JSON (${response.status}) for ${response.url || "request"}. Check the server route, authentication, or upstream error page.`)
    }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Server returned an invalid JSON response (${response.status}).`)
    }
  }

  return data as T | null
}

export async function parseJsonResponse<T = any>(response: Response): Promise<T> {
  const data = await readJsonResponse<T>(response)

  if (!response.ok) {
    const body: any = data || {}
    throw new Error(body?.error || body?.message || "API request failed")
  }

  return data as T
}
