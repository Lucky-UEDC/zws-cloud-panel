import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
      key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self' https://api.cashfree.com https://sandbox.cashfree.com https://secure.phonepe.com https://mercury.phonepe.com https://api.razorpay.com https://checkout.razorpay.com",
      "frame-src 'self' https://sdk.cashfree.com https://api.cashfree.com https://sandbox.cashfree.com https://secure.phonepe.com https://mercury.phonepe.com https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "script-src 'self' 'unsafe-inline' https://sdk.cashfree.com https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com https://www.google-analytics.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://api.cashfree.com https://sandbox.cashfree.com https://api.phonepe.com https://api-preprod.phonepe.com https://secure.phonepe.com https://mercury.phonepe.com https://api.razorpay.com https://checkout.razorpay.com https://cdn.razorpay.com https://www.google-analytics.com https://www.google.com https://challenges.cloudflare.com https://static.cloudflareinsights.com https://cloudflareinsights.com wss:",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), interest-cohort=()",
  },
]

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  })
}

function cleanHost(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase()
}

const appHosts = [
  process.env.SITE_DOMAIN,
  process.env.APP_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXTAUTH_URL,
].map(cleanHost).filter(Boolean)

const serverActionAllowedOrigins = Array.from(new Set([
  ...appHosts,
  ...appHosts.map((host) => host.startsWith("www.") ? "" : `www.${host}`),
  ...(process.env.NODE_ENV !== "production" && process.env.PORT ? [`localhost:${process.env.PORT}`, `127.0.0.1:${process.env.PORT}`] : []),
].filter(Boolean)))

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  outputFileTracingExcludes: {
    "*": [
      "./.env",
      "./.env.*",
      "./.git/**/*",
      "./.next/cache/**/*",
      "./.next/dev/**/*",
      "./.next/standalone/**/*",
      "./backups/**/*",
      "./core",
      "./core/**/*",
      "./logs/**/*",
      "./release-artifacts/**/*",
      "./releases/**/*",
      "./test-results/**/*",
    ],
  },
  serverExternalPackages: ["puppeteer", "puppeteer-core", "ssh2"],
  experimental: {
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
    },
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-tooltip",
      "framer-motion",
      "recharts",
      "date-fns",
    ],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.cloudflare.com" },
      { protocol: "https", hostname: "**.cloudflareusercontent.com" },
      { protocol: "https", hostname: "**.myrdphub.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
  cacheMaxMemorySize: 8 * 1024 * 1024,
  webpack(config, { isServer }) {
    config.cache = false
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /@novnc\/novnc\/core\/util\/browser\.js/,
        message: /topLevelAwait/,
      },
    ]

    if (isServer) {
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.done.tap("ProxyTraceCompatibilityPlugin", () => {
            const outputPath = compiler.options.output?.path
            if (!outputPath) return
            const middlewareTrace = path.join(outputPath, "middleware.js.nft.json")
            const proxyTrace = path.join(outputPath, "proxy.js.nft.json")
            if (fs.existsSync(proxyTrace) || !fs.existsSync(middlewareTrace)) return
            fs.copyFileSync(middlewareTrace, proxyTrace)
          })
        },
      })
    }
    return config
  },
  async headers() {
    return [
      {
        source: "/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/client-area/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/checkout/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/payment/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/invoice/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/login/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
  async redirects() {
    return [
      {
        source: "/admin/virtual-machines",
        destination: "/admin/vms",
        permanent: false,
      },
      {
        source: "/admin/vm-networking",
        destination: "/admin/ip-pools",
        permanent: false,
      },
      {
        source: "/admin/ip-assignment",
        destination: "/admin/ip-pools",
        permanent: false,
      },
      {
        source: "/admin/network-events",
        destination: "/admin/ip-pools",
        permanent: false,
      },
      {
        source: "/admin/settings/email",
        destination: "/admin/email",
        permanent: false,
      },
      {
        source: "/admin/settings/infrastructure",
        destination: "/admin/compute-nodes",
        permanent: false,
      },
      {
        source: "/proxmox-vps",
        destination: "/compute-instances",
        permanent: true,
      },
    ]
  },
}

export default nextConfig
