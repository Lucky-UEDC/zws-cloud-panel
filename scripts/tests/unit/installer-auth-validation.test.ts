import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("installer supports external database without installing host postgres", () => {
  const installer = read("installer/install.sh")
  assert.match(installer, /DATABASE_MODE="\$\{DATABASE_MODE:-external\}"/)
  assert.match(installer, /EXTERNAL_DATABASE_URL/)
  assert.match(installer, /docker compose/)
  assert.doesNotMatch(installer, /postgresql-client/)
  assert.doesNotMatch(installer, /pnpm install/)
})

test("installer only installs Docker, Docker Compose, Cloudflared, and minimal fetch tooling", () => {
  const installer = read("installer/install.sh")
  assert.match(installer, /docker-ce/)
  assert.match(installer, /docker-compose-plugin/)
  assert.match(installer, /cloudflared/)
  assert.doesNotMatch(installer, /nodejs/)
  assert.doesNotMatch(installer, /pm2/i)
})

test("docker compose local database example uses postgres 17 without public 5432 publishing", () => {
  const compose = read("docker-compose.yml")
  assert.match(compose, /postgres:17-alpine/)
  assert.match(compose, /profiles: \["local-db"\]/)
  assert.doesNotMatch(compose, /"5432:5432"/)
})
