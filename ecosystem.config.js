import fs from "node:fs"

const ROOT_DIR = process.env.ZWS_ROOT_DIR || "/var/www/myrdphub"
const SHARED_DIR = process.env.ZWS_SHARED_DIR || `${ROOT_DIR}/shared`
const LOG_DIR = process.env.ZWS_LOG_DIR || `${ROOT_DIR}/logs`
const ENV_FILE = process.env.ZWS_ENV_FILE || (fs.existsSync(`${SHARED_DIR}/.env.production`) ? `${SHARED_DIR}/.env.production` : `${ROOT_DIR}/.env`)
const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH || "/storage/whatsapp-session"

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const index = trimmed.indexOf("=")
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const baseEnv = {
  ...readEnvFile(ENV_FILE),
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: "--max-old-space-size=4096 --no-deprecation",
  ZWS_ROOT_DIR: ROOT_DIR,
  ZWS_SHARED_DIR: SHARED_DIR,
  ZWS_LOG_DIR: LOG_DIR,
  ENV_FILE,
  REQUIRED_PM2_APPS: process.env.REQUIRED_PM2_APPS || "zws-web,zws-whatsapp,zws-worker,zws-proxmox-events,zws-vnc-proxy",
}

function app(config) {
  const name = config.name
  return {
    name,
    cwd: ROOT_DIR,
    watch: false,
    autorestart: true,
    instances: 1,
    exec_mode: "fork",
    min_uptime: "20s",
    max_restarts: 20,
    restart_delay: 5_000,
    exp_backoff_restart_delay: 500,
    kill_timeout: 30_000,
    max_memory_restart: config.max_memory_restart || "900M",
    error_file: `${LOG_DIR}/${name}.error.log`,
    out_file: `${LOG_DIR}/${name}.log`,
    merge_logs: true,
    time: true,
    ...config,
  }
}

export const apps = [
    app({
      name: "zws-web",
      script: "workers/zws-web.js",
      max_memory_restart: "2G",
      env: {
        ...baseEnv,
        APP_DIR: ROOT_DIR,
        HOSTNAME: "127.0.0.1",
        PORT: process.env.PORT || baseEnv.PORT || "3000",
        ZWS_BOOT_AUTHORITY: "pm2",
        REQUIRE_STANDALONE_STATIC: "1",
      },
    }),
    app({
      name: "zws-whatsapp",
      script: "node",
      args: "--import tsx scripts/whatsapp-worker.ts",
      interpreter: "none",
      kill_timeout: 45_000,
      max_memory_restart: "1G",
      out_file: `${LOG_DIR}/whatsapp.log`,
      error_file: `${LOG_DIR}/whatsapp.error.log`,
      env: {
        ...baseEnv,
        WHATSAPP_RUNTIME_OWNER: "worker",
        ZWS_WHATSAPP_WORKER: "true",
        WHATSAPP_SESSION_PATH: SESSION_PATH,
        WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER || baseEnv.WHATSAPP_PROVIDER || "evolution",
      },
    }),
    app({
      name: "zws-worker",
      script: "node",
      args: "--import tsx workers/zws-worker.ts",
      interpreter: "none",
      max_memory_restart: "1400M",
      env: {
        ...baseEnv,
        VNC_PROXY_HOST: process.env.VNC_PROXY_HOST || baseEnv.VNC_PROXY_HOST || "127.0.0.1",
        VNC_PROXY_PORT: process.env.VNC_PROXY_PORT || baseEnv.VNC_PROXY_PORT || "3001",
      },
    }),
    app({
      name: "zws-proxmox-events",
      script: "node",
      args: "--import tsx scripts/proxmox-event-watcher.ts",
      interpreter: "none",
      max_memory_restart: "500M",
      out_file: `${LOG_DIR}/proxmox-sync.log`,
      error_file: `${LOG_DIR}/proxmox-sync.error.log`,
      env: {
        ...baseEnv,
      },
    }),
    app({
      name: "zws-vnc-proxy",
      script: "node",
      args: "--import tsx scripts/vnc-proxy-server.ts",
      interpreter: "none",
      max_memory_restart: "700M",
      env: {
        ...baseEnv,
        VNC_PROXY_HOST: process.env.VNC_PROXY_HOST || baseEnv.VNC_PROXY_HOST || "127.0.0.1",
        VNC_PROXY_PORT: process.env.VNC_PROXY_PORT || baseEnv.VNC_PROXY_PORT || "3001",
      },
    }),
]

const ecosystem = { apps }

export default ecosystem
