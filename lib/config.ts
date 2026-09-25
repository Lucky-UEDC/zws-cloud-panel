/**
 * Configuration validation and centralized config management
 * LAZY EVALUATION - Only validates when config is accessed at runtime
 */

import { ensureDatabaseUrl, resolveDatabaseUrlFromEnv } from "@/lib/db-url"

function getEnvVariable(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (!value && defaultValue === undefined) {
    console.warn(`[Config] Warning: Missing environment variable: ${key}`)
    return ''
  }
  return value || defaultValue || ''
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key]
  if (value === undefined) {
    if (defaultValue === undefined) {
      console.warn(`[Config] Warning: Missing environment variable: ${key}`)
      return 0
    }
    return defaultValue
  }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    console.warn(`[Config] Warning: Invalid number for environment variable ${key}: ${value}`)
    return defaultValue || 0
  }
  return parsed
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key]
  if (value === undefined) {
    if (defaultValue === undefined) {
      return false
    }
    return defaultValue
  }
  return value === 'true' || value === '1' || value === 'yes'
}

// Lazy-loaded config - only validated when actually used
let configValidated = false

export const config = {
  // Database Configuration
  get database() {
    const databaseUrl = ensureDatabaseUrl()
    return {
      url: databaseUrl,
      isConfigured: !!databaseUrl,
    }
  },

  // Redis Configuration (Optional)
  get redis() {
    return {
      url: process.env.REDIS_URL || '',
      enabled: !!process.env.REDIS_URL,
    }
  },

  // App Configuration
  get app() {
    return {
      url: getEnvVariable('APP_URL', getEnvVariable('NEXT_PUBLIC_APP_URL', '')),
      nodeEnv: getEnvVariable('NODE_ENV', 'development'),
      isDevelopment: process.env.NODE_ENV === 'development',
      isProduction: process.env.NODE_ENV === 'production',
    }
  },

  // Admin Authentication Configuration
  get admin() {
    return {
      email: getEnvVariable('ADMIN_EMAIL', 'admin@example.com'),
      // Bootstrap-only password used by seed/init flows, not runtime auth.
      password: getEnvVariable('ADMIN_PASSWORD', ''),
      displayName: getEnvVariable('ADMIN_DISPLAY_NAME', 'Administrator'),
      jwtSecret: getEnvVariable('JWT_SECRET', 'dev-secret-change-in-production'),
      sessionTimeout: getEnvNumber('SESSION_TIMEOUT_MINUTES', 1440),
      maxLoginAttempts: getEnvNumber('MAX_LOGIN_ATTEMPTS', 5),
      lockoutDuration: getEnvNumber('LOCKOUT_DURATION_MINUTES', 15),
    }
  },

  // Payment credentials are stored in PostgreSQL admin settings.
  get payments() {
    return {}
  },

  // Mail credentials are stored in PostgreSQL admin settings.
  get mail() {
    return {}
  },

  // Business Configuration
  get business() {
    return {
      name: getEnvVariable('COMPANY_NAME', 'Cloud Platform'),
      email: getEnvVariable('COMPANY_EMAIL', ''),
      phone: getEnvVariable('COMPANY_PHONE', '+91 80 1234 5678'),
      address: getEnvVariable('COMPANY_ADDRESS', '123 Tech Park, Bangalore'),
      gstIn: process.env.COMPANY_GST_IN || '',
    }
  },

  // Pricing Configuration
  get pricing() {
    return {
      defaultCurrency: 'INR',
      defaultTaxRate: getEnvNumber('DEFAULT_TAX_RATE', 18),
      discounts: {
        threeMonth: getEnvNumber('DISCOUNT_3M', 10),
        sixMonth: getEnvNumber('DISCOUNT_6M', 15),
        twelveMonth: getEnvNumber('DISCOUNT_12M', 20),
        twentyFourMonth: getEnvNumber('DISCOUNT_24M', 25),
      },
    }
  },

  // Feature Limits
  get limits() {
    return {
      maxCustomRamGb: getEnvNumber('MAX_CUSTOM_RAM_GB', 256),
      maxCustomCpu: getEnvNumber('MAX_CUSTOM_CPU', 64),
      maxCustomStorageGb: getEnvNumber('MAX_CUSTOM_STORAGE_GB', 4000),
    }
  },

  // Logging Configuration
  get logging() {
    return {
      level: getEnvVariable('LOG_LEVEL', 'info'),
      enableDetailedLogs: getEnvBoolean('ENABLE_DETAILED_LOGS', false),
    }
  },
}

/**
 * Validates critical environment variables for runtime operations
 * Call this only when actually needed (API routes that use the database)
 */
export function validateConfig(): void {
  if (configValidated) return

  const missingVars: string[] = []
  const warnings: string[] = []

  try {
    // Core requirements
    const dbResolution = resolveDatabaseUrlFromEnv()
    if (!dbResolution.configured) {
      missingVars.push(...dbResolution.missing)
    }
    if (!process.env.ADMIN_EMAIL) {
      warnings.push('ADMIN_EMAIL not set - using default')
    }
    for (const key of ['JWT_SECRET', 'SESSION_SECRET', 'NEXTAUTH_SECRET', 'ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY', 'PRICE_TOKEN_SECRET', 'INVOICE_SHARE_SECRET']) {
      if (!process.env[key]) {
        if (process.env.NODE_ENV === 'production') missingVars.push(key)
        else warnings.push(`${key} not set - using development fallback where available`)
      }
    }

    // Optional services
    if (!process.env.REDIS_URL) warnings.push('REDIS_URL not set - Redis-backed runtime features use DB/in-memory fallback')

    if (missingVars.length > 0) {
      console.error('[Config] ✗ Critical configuration missing:')
      missingVars.forEach((v) => console.error(`  - ${v}`))
      throw new Error(`Missing ${missingVars.length} critical environment variable(s)`)
    }

    if (warnings.length > 0) {
      console.warn('[Config] ⚠ Optional services not configured:')
      warnings.forEach((w) => console.warn(`  - ${w}`))
    }

    configValidated = true
    console.log('[Config] ✓ Critical configuration validated')
  } catch (error) {
    console.error('[Config] ✗ Configuration validation failed')
    throw error
  }
}

export default config
