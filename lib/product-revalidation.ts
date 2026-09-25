import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"

const PRODUCT_PATHS = [
  "/",
  "/pricing",
  "/vps",
  "/compute-instances",
  "/cloud",
  "/cloud-vps",
  "/cheap-vps",
  "/vps-hosting",
  "/dedicated",
  "/client-area/deploy",
  "/checkout",
]

export function revalidateProductSurfaces() {
  for (const path of PRODUCT_PATHS) {
    revalidatePath(path)
  }
  revalidateTag("products", "max")
}

export function scheduleProductSurfaceRevalidation() {
  const run = () => {
    try {
      revalidateProductSurfaces()
    } catch (error) {
      console.warn("[products] surface revalidation skipped", error)
    }
  }

  try {
    after(run)
  } catch {
    if (typeof setImmediate === "function") {
      setImmediate(run)
    } else {
      setTimeout(run, 0)
    }
  }
}
