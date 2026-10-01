import { NextResponse } from "next/server"

export async function GET() {
  const compose = `version: "3.9"

x-zws-env: &zws-env
  NODE_ENV: production
  ZWS_RUNTIME: docker
  HOME: /tmp
  COREPACK_HOME: /tmp/corepack
  XDG_CACHE_HOME: /tmp/.cache
  ZWS_STARTUP_STRICT: \${ZWS_STARTUP_STRICT:-1}
  DATABASE_MODE: \${DATABASE_MODE:-external}
  DATABASE_TUNNEL_HOSTNAME: \${DATABASE_TUNNEL_HOSTNAME:-db.zwscloud.com}
  DATABASE_TUNNEL_PORT: \${DATABASE_TUNNEL_PORT:-15432}
  DATABASE_NAME: \${DATABASE_NAME:-zwscloud}
  DATABASE_USER: \${DATABASE_USER:-zwscloud_app}
  DATABASE_URL: \${DOCKER_DATABASE_URL:-\${DATABASE_URL:-}}
  EXTERNAL_DATABASE_URL: \${DOCKER_EXTERNAL_DATABASE_URL:-}
  LOCAL_DATABASE_URL: \${DOCKER_LOCAL_DATABASE_URL:-}
  POSTGRES_DB: \${POSTGRES_DB:-zwscloud}
  POSTGRES_USER: \${POSTGRES_USER:-zwscloud_app}
  POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-CHANGE_ME}
  REDIS_URL: \${DOCKER_REDIS_URL:-redis://redis:6379/0}
  SITE_DOMAIN: \${SITE_DOMAIN:-localhost}
  APP_URL: \${APP_URL:-http://localhost}
  NEXT_PUBLIC_APP_URL: \${NEXT_PUBLIC_APP_URL:-http://localhost}
  NEXTAUTH_URL: \${NEXTAUTH_URL:-http://localhost}
  NEXTAUTH_SECRET: \${NEXTAUTH_SECRET:-CHANGE_ME_BASE64}
  ENCRYPTION_KEY: \${ENCRYPTION_KEY:-CHANGE_ME_32_BYTE_HEX}
  MFA_ENCRYPTION_KEY: \${MFA_ENCRYPTION_KEY:-CHANGE_ME_32_BYTE_HEX}
  WHATSAPP_PROVIDER: evolution
  EVOLUTION_API_URL: \${EVOLUTION_API_URL:-}
  EVOLUTION_INSTANCE: \${EVOLUTION_INSTANCE:-}
  EVOLUTION_API_KEY: \${EVOLUTION_API_KEY:-}
  EVOLUTION_INSTANCE_TOKEN: \${EVOLUTION_INSTANCE_TOKEN:-}
  EVOLUTION_TEST_RECIPIENT: \${EVOLUTION_TEST_RECIPIENT:-}
  VNC_PROXY_HOST: \${VNC_PROXY_HOST:-0.0.0.0}
  VNC_PROXY_PORT: \${VNC_PROXY_PORT:-3001}
  WORKER_HEALTH_PORT: \${WORKER_HEALTH_PORT:-3100}
  SCHEDULER_HEALTH_PORT: \${SCHEDULER_HEALTH_PORT:-3101}
  ZWS_BACKUP_DIR: /app/backups
  ZWS_LOG_DIR: /app/logs
  ZWS_UPLOAD_DIR: /app/uploads
  DEPLOYMENT_REPORT_DIR: /app/deployment-reports
  BROWSER_AUTOMATION_ENABLED: \${BROWSER_AUTOMATION_ENABLED:-1}
  CLOUDFLARE_ONLY_MODE: \${CLOUDFLARE_ONLY_MODE:-false}
  DIRECT_CLOUDFLARE_MODE: \${DIRECT_CLOUDFLARE_MODE:-false}
  CF_TUNNEL_SERVICE: \${CF_TUNNEL_SERVICE:-http://app:3000}
  PROXMOX_LIVE_SSE_POLL_MS: \${PROXMOX_LIVE_SSE_POLL_MS:-250}
  PROXMOX_EVENT_WATCH_MS: \${PROXMOX_EVENT_WATCH_MS:-250}
  PUPPETEER_EXECUTABLE_PATH: /usr/bin/chromium

x-zws-logging: &zws-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "2"
    compress: "true"

x-zws-service: &zws-service
  build:
    context: .
    target: runner
    args:
      APP_VERSION: \${APP_VERSION:-1.1.2}
      APP_COMMIT: \${APP_COMMIT:-}
      APP_SOURCE_DATE: \${APP_SOURCE_DATE:-}
  image: zws-cloud:latest
  restart: unless-stopped
  mem_limit: 1g
  logging: *zws-logging
  env_file:
    - path: .env
      required: false
  environment:
    <<: *zws-env
  extra_hosts:
    - "host.docker.internal:host-gateway"
  volumes:
    - zws_logs:/app/logs
    - zws_backups:/app/backups
    - zws_reports:/app/deployment-reports
    - zws_uploads:/app/uploads
  depends_on:
    redis:
      condition: service_healthy
    host-redis-proxy:
      condition: service_started
    migrate:
      condition: service_completed_successfully
  networks:
    - zws

services:
  db-tunnel:
    image: cloudflare/cloudflared:latest
    profiles: ["db-tunnel"]
    restart: unless-stopped
    command:
      - access
      - tcp
      - --hostname
      - \${DATABASE_TUNNEL_HOSTNAME:-db.zwscloud.com}
      - --url
      - tcp://postgres:5432
    networks:
      - zws

  postgres:
    image: postgres:17-alpine
    profiles: ["local-db"]
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-zwscloud}
      POSTGRES_USER: \${POSTGRES_USER:-zwscloud_app}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-CHANGE_ME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-zwscloud_app} -d \${POSTGRES_DB:-zwscloud}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - zws

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - zws

  host-redis-proxy:
    image: alpine/socat:latest
    restart: unless-stopped
    command: TCP-LISTEN:6379,fork,reuseaddr TCP:redis:6379
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - zws

  migrate:
    image: zws-cloud:latest
    restart: "no"
    env_file:
      - path: .env
        required: false
    environment:
      <<: *zws-env
    command: ["pnpm", "prisma", "migrate", "deploy"]
    depends_on:
      - redis
      - host-redis-proxy
      - postgres
    profiles: ["local-db"]
    networks:
      - zws

  app:
    <<: *zws-service
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - redis
      - host-redis-proxy
      - migrate

  worker:
    <<: *zws-service
    command: ["node", "workers/zws-worker.ts"]
    ports:
      - "3100:3100"
    depends_on:
      - app
    profiles: ["worker"]

  scheduler:
    <<: *zws-service
    command: ["node", "workers/zws-scheduler.ts"]
    ports:
      - "3101:3101"
    depends_on:
      - app
    profiles: ["scheduler"]

volumes:
  zws_logs:
  zws_backups:
  zws_reports:
  zws_uploads:
  redis_data:
  postgres_data:

networks:
  zws:
    driver: bridge
`

  return new NextResponse(compose, {
    headers: {
      "Content-Type": "text/yaml",
      "Cache-Control": "no-store",
    },
  })
}