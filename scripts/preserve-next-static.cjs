const fs = require("fs")
const path = require("path")

const source = path.join(".next", "static")
const target = path.join(".next-static-previous")

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name)
    const targetPath = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(sourcePath, targetPath)
    else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath)
  }
  return true
}

fs.rmSync(target, { force: true, recursive: true })
if (copyDir(source, target)) {
  console.log("[preserve-next-static] preserved previous .next/static assets")
} else {
  console.log("[preserve-next-static] no previous .next/static assets to preserve")
}
