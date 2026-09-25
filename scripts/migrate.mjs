#!/usr/bin/env node

/**
 * Database Migration Script
 * Run with: pnpm prisma migrate dev --name <migration_name>
 * Or run: pnpm prisma db push
 * Or run: node scripts/migrate.mjs
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function migrate() {
  console.log('🔄 Running Prisma migrations...\n')

  return new Promise((resolve, reject) => {
    const prisma = spawn('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: dirname(__dirname),
      stdio: 'inherit',
    })

    prisma.on('close', (code) => {
      if (code === 0) {
        console.log('\n✓ Migrations completed successfully')
        resolve(code)
      } else {
        console.error('\n✗ Migration failed with code:', code)
        reject(code)
      }
    })

    prisma.on('error', (err) => {
      console.error('✗ Migration process error:', err)
      reject(err)
    })
  })
}

migrate().catch((error) => {
  process.exit(1)
})
