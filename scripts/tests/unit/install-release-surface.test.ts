import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import test from "node:test"

const RELEASES_DIR = "public/releases"
const ARCHIVE_PATTERN = /^zws-cloud-panel-\d+\.\d+\.\d+\.tar\.gz$/

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("release routes only select versioned archives, never the latest symlink", () => {
  for (const route of [
    "app/api/install/release/route.ts",
    "app/api/install/release.sha256/route.ts",
  ]) {
    const source = read(route)
    assert.ok(
      source.includes(ARCHIVE_PATTERN.source),
      `${route} must filter with the versioned archive pattern`
    )
    assert.doesNotMatch(
      source,
      /endsWith\("\.tar\.gz"\)/,
      `${route} must not select archives by extension alone (matches the 'latest' symlink)`
    )
  }
})

test("release checksum route resolves the real .tar.gz.sha256 filename", () => {
  const source = read("app/api/install/release.sha256/route.ts")
  // "zws-cloud-panel-1.1.25.tar.gz" + ".sha256" is the name create-release.sh writes.
  assert.match(source, /\$\{latest\}\.sha256/)
  assert.doesNotMatch(
    source,
    /replace\(["']\.tar\.gz["'],\s*["']\.sha256["']\)/,
    "replacing .tar.gz with .sha256 drops the .tar suffix and misses the file"
  )
})

test("published release archives are small and never embed earlier releases", () => {
  if (!existsSync(RELEASES_DIR)) return

  const archives = readdirSync(RELEASES_DIR).filter((f) => ARCHIVE_PATTERN.test(f))
  assert.ok(archives.length > 0, "at least one versioned release archive must exist")

  for (const archive of archives) {
    const { size } = statSync(join(RELEASES_DIR, archive))
    assert.ok(
      size < 64 * 1024 * 1024,
      `${archive} is ${(size / 1024 / 1024).toFixed(1)}MB; archives must exclude public/releases to avoid self-inclusion`
    )
    assert.ok(existsSync(join(RELEASES_DIR, `${archive}.sha256`)), `${archive}.sha256 must exist`)
  }
})

test("release builder excludes heavyweight and self-referential directories", () => {
  const script = read("scripts/create-release.sh")
  for (const excluded of [
    "node_modules",
    ".next",
    "public/releases",
    "certs",
    ".env*",
  ]) {
    assert.ok(
      new RegExp(`--exclude ['"]/?${excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?`).test(
        script
      ),
      `create-release.sh must exclude ${excluded}`
    )
  }
})

test("release builder anchors directory excludes to the repo root", () => {
  const script = read("scripts/create-release.sh")

  // An unanchored rsync exclude matches at ANY depth. Excluding `backups` or
  // `logs` without a leading slash silently deletes real source routes such as
  // app/admin/backups, app/api/admin/logs and app/uploads from the release,
  // producing an archive that fails the build's route-manifest verification.
  const unanchored = [...script.matchAll(/--exclude ['"]?([A-Za-z0-9_.-]+)['"]?/g)]
    .map((m) => m[1])
    .filter((name) =>
      [
        "node_modules",
        ".git",
        ".next",
        "pnpm-store",
        "next-static-previous",
        "turbo",
        "vercel",
        "coverage",
        "nyc_output",
        "releases",
        "certs",
        "acme-webroot",
        "logs",
        "backups",
        "reports",
        "uploads",
        "deployment-reports",
        "screenshots",
        "test-results",
        "playwright-report",
      ].includes(name)
    )

  assert.deepEqual(
    unanchored,
    [],
    `these directory excludes are unanchored and will match app/ routes too: ${unanchored.join(", ")}`
  )

  // The builder must verify the route tree survived the copy.
  assert.match(script, /Verifying route tree/)
})

test("release archive contains every source route file", () => {
  if (!existsSync(RELEASES_DIR)) return

  const archives = readdirSync(RELEASES_DIR)
    .filter((f) => ARCHIVE_PATTERN.test(f))
    .sort()
  if (archives.length === 0) return

  const latest = archives[archives.length - 1]!
  const prefix = latest.replace(/\.tar\.gz$/, "")

  // recursive readdirSync reports directories without a trailing slash, so stat
// each entry to keep only files (tar lists directories too).
const sourceRoutes = readdirSync("app", { recursive: true })
    .map(String)
    .filter((p) => !/\.(log|tsbuildinfo)$/.test(p))
    .map((p) => `app/${p}`) // readdirSync is relative to app/
    .filter((p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    })
    .sort()

  assert.ok(sourceRoutes.length > 100, "sanity check on the source route tree")

  let listing: string
  try {
    listing = execFileSync("tar", ["-tzf", join(RELEASES_DIR, latest)], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return // tar unavailable; the shell-side verification still guards the build
  }

  const archived = new Set(
    listing
      .split("\n")
      .filter((l) => l.startsWith(`${prefix}/app/`) && !l.endsWith("/"))
      .map((l) => l.slice(prefix.length + 1))
  )

  const missing = sourceRoutes.filter((p) => !archived.has(p))
  assert.deepEqual(
    missing,
    [],
    `${latest} is missing ${missing.length} app/ file(s), e.g. ${missing.slice(0, 5).join(", ")}`
  )
})

test("release archives are mounted into the app instead of baked into the image", () => {
  const compose = read("docker-compose.yml")
  assert.match(
    compose,
    /public\/releases:\/app\/\.next\/standalone\/public\/releases:ro/,
    "Next.js standalone chdirs into .next/standalone, so releases must be mounted there"
  )
})

test("nginx resolves the app per request so container IP changes cannot cause 502s", () => {
  const conf = read("config/nginx/docker.conf")

  // An `upstream` block resolves app's IP when nginx parses its config. Every
  // deploy recreates the app container, so that pinned IP goes stale and nginx
  // serves 502 until someone reloads it by hand.
  assert.doesNotMatch(conf, /upstream\s+zws_app/)
  assert.doesNotMatch(conf, /upstream\s+zws_console_proxy/)
  assert.match(conf, /resolver\s+127\.0\.0\.11\s+valid=\d+s\s+ipv6=off;/)
  assert.match(conf, /set \$zws_app_upstream http:\/\/app:3000;/)
  assert.match(conf, /set \$zws_console_upstream http:\/\/worker:3001;/)
  // Every proxied location must go through the variable form.
  assert.doesNotMatch(conf, /proxy_pass\s+http:\/\/(app|worker):/)
  assert.match(conf, /proxy_pass \$zws_app_upstream;/)
  assert.match(conf, /proxy_pass \$zws_console_upstream\/console\/proxy\/\$1\/\$2;/)
  assert.match(conf, /proxy_pass \$zws_console_upstream\/vnc\/proxy\/\$1;/)
})

test("nginx health probe is served by nginx, not the app's degraded state", () => {
  const conf = read("config/nginx/docker.conf")
  const compose = read("docker-compose.yml")
  // A fresh install reports degraded (optional integrations unconfigured), which
  // would keep the nginx container permanently unhealthy.
  assert.match(conf, /location = \/nginx-health \{/)
  assert.match(compose, /wget -qO- http:\/\/127\.0\.0\.1\/nginx-health/)
  assert.doesNotMatch(compose, /wget -qO- http:\/\/127\.0\.0\.1\/api\/health/)
})

test("fresh databases are baselined instead of replaying migrations in order", () => {
  const entrypoint = read("docker-entrypoint.sh")

  // The earliest migrations reference tables that later migrations create, so a
  // fresh install cannot run `migrate deploy` from zero.
  assert.match(entrypoint, /database_is_fresh/)
  assert.match(entrypoint, /bootstrap_fresh_database/)
  assert.match(entrypoint, /prisma db push --accept-data-loss/)
  assert.match(entrypoint, /prisma migrate resolve --applied/)

  // Freshness must come from the database contents, never from a flag, so it
  // cannot fire against a populated database such as production.
  const lines = entrypoint.split("\n")
  const start = lines.findIndex((l) => /^database_is_fresh\(\)/.test(l))
  assert.ok(start >= 0, "database_is_fresh() must be defined")
  // Brace matching is unsafe here: the body contains ${DATABASE_URL%%\?*}.
  const end = lines.findIndex((l, i) => i > start && l.trim() === "}")
  const freshBody = lines.slice(start, end + 1).join("\n")

  assert.match(
    freshBody,
    /pg_tables[\s\S]*tablename <> '_prisma_migrations'/,
    "freshness must be detected by counting application tables"
  )
  assert.match(freshBody, /count" == "0"/)

  // The migrate case must gate the bootstrap behind that check.
  const migrateCase = entrypoint.slice(
    entrypoint.indexOf("  migrate)"),
    entrypoint.indexOf("  app)")
  )
  assert.match(migrateCase, /if database_is_fresh; then\s*\n\s*bootstrap_fresh_database/)
  // `migrate deploy` must still run afterwards and remain the only deploy path.
  assert.match(migrateCase, /prisma migrate deploy/)
  assert.doesNotMatch(entrypoint, /migrate reset/)
})

test("reinstall preserves existing .env secrets while adding new keys", () => {
  const installer = read("installer/install-direct.sh")

  // Regenerating .env on a reinstall would rotate POSTGRES_PASSWORD against an
  // already-initialised volume and rotate ENCRYPTION_KEY out from under existing
  // encrypted rows, locking the operator out of their own data.
  assert.match(installer, /if \[\[ -f \.env \]\]; then/)
  assert.match(installer, /Existing \.env found - preserving/)
  assert.match(installer, /\.env\.pre-update/)
  // Existing values win; only unknown keys come from the generated set.
  assert.match(installer, /grep -q "\^\$\{key\}=" "\$merged" \|\| printf '%s\\n' "\$line" >> "\$merged"/)
  assert.match(installer, /chmod 600 \.env/)
})

test("installer never drops volumes or resets the database on reinstall", () => {
  const installer = read("installer/install-direct.sh")
  assert.doesNotMatch(installer, /migrate reset/)
  assert.doesNotMatch(installer, /docker compose[^\n]*down -v/)
  assert.doesNotMatch(installer, /volume rm/)
})

test("installer requests a real Let's Encrypt certificate over HTTP-01", () => {
  const installer = read("installer/install-direct.sh")
  assert.match(installer, /certbot\/certbot:latest/)
  assert.match(installer, /--webroot/)
  assert.match(installer, /--agree-tos/)
  assert.doesNotMatch(installer, /--standalone/, "standalone mode would require stopping nginx")
})

test("installer starts the nginx profile so the public entrypoint is published", () => {
  const installer = read("installer/install-direct.sh")
  assert.match(installer, /--profile local-db --profile nginx up -d/)
})

test("installer seeds the admin account through the guarded init endpoint", () => {
  const installer = read("installer/install-direct.sh")
  assert.match(installer, /api\/admin\/init/)
  // The password must not be left behind on disk once the account exists.
  assert.match(installer, /scrub_admin_password/)
})

test("installer does not require a GitHub clone, token, or external database", () => {
  const installer = read("installer/install-direct.sh")
  // Ignore comments/prose so a line like "# No GitHub, no git clone" is allowed.
  const code = installer
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")

  assert.doesNotMatch(code, /\bgit\s+(clone|pull|fetch)\b/)
  assert.doesNotMatch(code, /GITHUB_TOKEN/)
  assert.doesNotMatch(code, /REPO_URL|BRANCH=/)
  assert.match(installer, /DATABASE_MODE="local"/)
})

test("prompt helpers only print; every question is answered on /dev/tty", () => {
  const installer = read("installer/install-direct.sh")

  // When piped from curl the installer script occupies stdin, so any helper that
  // reads stdin instead of /dev/tty consumes the script itself and dies silently.
  for (const helper of ["prompt", "prompt_secret"]) {
    const body = installer.match(new RegExp(`^${helper}\\(\\) \\{([^}]*)\\}`, "m"))
    assert.ok(body, `${helper}() must be defined`)
    assert.doesNotMatch(
      body![1],
      /\bread\b/,
      `${helper}() must only print; reading must go through the *_tty helpers`
    )
  }

  for (const reader of ["read_tty", "read_secret_tty"]) {
    assert.match(
      installer,
      new RegExp(`^${reader}\\(\\) \\{[^}]*< \\/dev\\/tty`, "m"),
      `${reader}() must read from /dev/tty`
    )
  }

  // Every prompt must be paired with an explicit tty read.
  const prompts = [...installer.matchAll(/^\s*prompt(?:_secret)?\s+"[^"]+"/gm)]
  assert.equal(prompts.length, 4)
  const reads = [...installer.matchAll(/^\s*read_(?:secret_)?tty\s+[A-Z_]+/gm)]
  assert.equal(reads.length, 4, "each of the 4 prompts needs exactly one tty read")
})

test("installer asks exactly four questions and reads them from /dev/tty", () => {
  const installer = read("installer/install-direct.sh")
  const config = installer.slice(
    installer.indexOf("prompt_configuration() {"),
    installer.indexOf("\ninstall_docker()")
  )
  const prompts = [...config.matchAll(/^\s*prompt(?:_secret)?\s+"([^"]+)"/gm)].map((m) => m[1])
  assert.equal(prompts.length, 4, `expected 4 prompts, got ${JSON.stringify(prompts)}`)
  assert.match(prompts[0], /Domain/)
  assert.match(prompts[1], /Admin email/)
  assert.match(prompts[2], /Admin password/)
  assert.match(prompts[3], /Confirm admin password/)
  // None of the four questions may ask for anything else.
  for (const label of prompts) {
    assert.doesNotMatch(label, /username/i)
    assert.doesNotMatch(label, /database|postgres|redis/i)
    assert.doesNotMatch(label, /repo|branch|release|github/i)
  }
  assert.match(installer, /read_tty\(\)\s*\{\s*read -r "\$1" < \/dev\/tty/)
})

test("generated .env is written with restrictive permissions", () => {
  const installer = read("installer/install-direct.sh")
  assert.match(installer, /chmod 600 \.env/)
})