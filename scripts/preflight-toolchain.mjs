import fs from "node:fs"
import path from "node:path"

function exists(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function findTsxLoader(root) {
  const direct = path.join(root, "node_modules", "tsx", "dist", "loader.mjs")
  if (exists(direct)) return direct

  const pnpmRoot = path.join(root, "node_modules", ".pnpm")
  if (!fs.existsSync(pnpmRoot)) return null
  const entries = fs.readdirSync(pnpmRoot).filter((entry) => entry.startsWith("tsx@"))
  for (const entry of entries) {
    const candidate = path.join(pnpmRoot, entry, "node_modules", "tsx", "dist", "loader.mjs")
    if (exists(candidate)) return candidate
  }
  return null
}

function main() {
  const root = process.cwd()
  const tsxLoader = findTsxLoader(root)
  if (!tsxLoader) {
    console.error("[Preflight] Toolchain check failed: tsx runtime is incomplete (missing dist/loader.mjs).")
    console.error("[Preflight] Run `pnpm install --force` (or clear pnpm store) before build/test.")
    process.exit(1)
  }
  console.log("[Preflight] Toolchain OK", { tsxLoader })
}

main()
