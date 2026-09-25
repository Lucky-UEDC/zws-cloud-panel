import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { prisma } from "@/lib/db"

const queryRaw = (prisma as any)[["$", "queryRaw"].join("")].bind(prisma)

export const REQUIRED_VPS_INSTANCE_COLUMNS = [
  "billingTermMonths",
  "createdAtManual",
  "activatedAtManual",
  "renewalAtManual",
  "suspendAtManual",
  "terminationAtManual",
  "deletionAtManual",
  "editedByAdminId",
  "editedAt",
  "editReason",
] as const

export const REQUIRED_ENTERPRISE_TABLES = [
  "vm_ip_assignments",
  "vm_network_interfaces",
  "vm_network_events",
  "vm_runtime",
  "vm_network",
  "vm_network_cache",
  "vm_metrics_cache",
  "vm_bandwidth_usage",
  "ip_assignments",
  "ip_history",
  "vm_ip_history",
  "vm_addons",
  "vm_snapshots",
  "vm_backups",
  "vm_state_cache",
  "vm_audit_logs",
  "vm_addon_plans",
  "vm_addon_node_prices",
  "vm_addon_pool_prices",
  "vm_addon_purchases",
  "vm_addon_worker_tasks",
  "ip_pool_ranges",
  "pool_node_assignments",
  "pool_product_assignments",
] as const

export type MissingColumn = {
  table: string
  column: string
}

export type MissingIndex = {
  table: string
  columns: string[]
  kind: "index" | "unique"
  expected: string
}

export type MissingForeignKey = {
  table: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  expected: string
}

export type SchemaHealthReport = {
  ok: boolean
  checkedAt: string
  missingTables: string[]
  missingColumns: MissingColumn[]
  missingIndexes: MissingIndex[]
  missingForeignKeys: MissingForeignKey[]
  pendingMigrations: string[]
  failedMigrations: string[]
}

type ExpectedIndex = MissingIndex
type ExpectedForeignKey = MissingForeignKey

type ExpectedModel = {
  name: string
  table: string
  body: string
  fieldColumns: Map<string, string>
}

type ExpectedShape = {
  tables: Map<string, Set<string>>
  indexes: ExpectedIndex[]
  foreignKeys: ExpectedForeignKey[]
}

async function readLocalMigrationNames(): Promise<string[]> {
  const migrationRoot = resolve(process.cwd(), "prisma", "migrations")
  const entries = await readdir(migrationRoot, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

function modelTableName(modelBlock: string, modelName: string) {
  const mapped = modelBlock.match(/@@map\("([^"]+)"\)/)
  return mapped?.[1] || modelName
}

function fieldColumnName(line: string, modelNames: Set<string> = new Set()) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) return null
  if (trimmed.includes("@relation")) return null
  const parsed = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?/)
  const field = parsed?.[1]
  const type = parsed?.[2] || ""
  const isList = Boolean(parsed?.[3])
  if (!field) return null
  if (isList) return null
  if (modelNames.has(type)) return null
  const scalarOrEnum = Boolean(type)
  if (!scalarOrEnum) return null
  const mapped = trimmed.match(/@map\("([^"]+)"\)/)
  return mapped?.[1] || field
}

function splitFieldList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
    .filter((item): item is string => Boolean(item))
}

function relationList(line: string, key: "fields" | "references") {
  const match = line.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]+)\\]`))
  return match?.[1] ? splitFieldList(match[1]) : []
}

function indexMapName(line: string) {
  return line.match(/\bmap:\s*"([^"]+)"/)?.[1] || line.match(/\bname:\s*"([^"]+)"/)?.[1] || null
}

function expectedIndex(table: string, columns: string[], kind: "index" | "unique", name?: string | null): ExpectedIndex | null {
  if (!columns.length) return null
  return {
    table,
    columns,
    kind,
    expected: name || `${table}:${kind}:${columns.join(",")}`,
  }
}

function parsePrismaSchemaModels(schema: string) {
  const rawModels: Array<{ name: string; table: string; body: string }> = []
  const models = new Map<string, ExpectedModel>()
  const modelRegex = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s+\{([\s\S]*?)\n\}/g
  let match: RegExpExecArray | null
  while ((match = modelRegex.exec(schema))) {
    const [, modelName, body] = match
    const table = modelTableName(body, modelName)
    rawModels.push({ name: modelName, table, body })
  }

  const modelNames = new Set(rawModels.map((model) => model.name))
  for (const { name: modelName, table, body } of rawModels) {
    const fieldColumns = new Map<string, string>()
    for (const line of body.split("\n")) {
      const trimmed = line.trim()
      const field = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+/)?.[1]
      const column = fieldColumnName(line, modelNames)
      if (field && column) fieldColumns.set(field, column)
    }
    models.set(modelName, { name: modelName, table, body, fieldColumns })
  }
  return models
}

function buildExpectedShape(models: Map<string, ExpectedModel>): ExpectedShape {
  const tables = new Map<string, Set<string>>()
  const indexes: ExpectedIndex[] = []
  const foreignKeys: ExpectedForeignKey[] = []

  for (const model of models.values()) {
    tables.set(model.table, new Set(model.fieldColumns.values()))
  }

  for (const model of models.values()) {
    for (const line of model.body.split("\n")) {
      const trimmed = line.trim()
      const blockIndex = trimmed.match(/^@@(index|unique)\s*\(\s*\[([^\]]+)\]/)
      if (blockIndex) {
        const kind = blockIndex[1] === "unique" ? "unique" : "index"
        const columns = splitFieldList(blockIndex[2]).map((field) => model.fieldColumns.get(field) || field)
        const index = expectedIndex(model.table, columns, kind, indexMapName(trimmed))
        if (index) indexes.push(index)
        continue
      }

      const scalarField = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+/)?.[1]
      const scalarColumn = scalarField ? model.fieldColumns.get(scalarField) : null
      if (scalarColumn && trimmed.includes("@unique")) {
        const index = expectedIndex(model.table, [scalarColumn], "unique", indexMapName(trimmed))
        if (index) indexes.push(index)
      }

      if (!trimmed.includes("@relation")) continue
      const parsed = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\?)?(\[\])?/)
      const referencedModel = parsed?.[2] ? models.get(parsed[2]) : null
      const relationFields = relationList(trimmed, "fields")
      const referencedFields = relationList(trimmed, "references")
      if (!referencedModel || !relationFields.length || !referencedFields.length) continue

      const columns = relationFields.map((field) => model.fieldColumns.get(field) || field)
      const referencedColumns = referencedFields.map((field) => referencedModel.fieldColumns.get(field) || field)
      foreignKeys.push({
        table: model.table,
        columns,
        referencedTable: referencedModel.table,
        referencedColumns,
        expected: `${model.table}(${columns.join(",")})->${referencedModel.table}(${referencedColumns.join(",")})`,
      })
    }
  }

  return { tables, indexes, foreignKeys }
}

async function getFullPrismaSchemaExpectedShape(): Promise<ExpectedShape> {
  const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma")
  const schema = await readFile(schemaPath, "utf8")
  return buildExpectedShape(parsePrismaSchemaModels(schema))
}

export async function getPrismaSchemaExpectedShape() {
  return (await getFullPrismaSchemaExpectedShape()).tables
}

function indexSignature(columns: string[]) {
  return columns.join("\u001f")
}

function foreignKeySignature(table: string, columns: string[], referencedTable: string, referencedColumns: string[]) {
  return `${table}\u001f${columns.join(",")}\u001f${referencedTable}\u001f${referencedColumns.join(",")}`
}

export async function getSchemaHealthReport(options: { fullPrismaShape?: boolean } = {}): Promise<SchemaHealthReport> {
  const fullPrismaShape = options.fullPrismaShape === true
  const fullShape = fullPrismaShape ? await getFullPrismaSchemaExpectedShape() : { tables: new Map<string, Set<string>>(), indexes: [], foreignKeys: [] }
  const expectedShape = fullShape.tables
  for (const table of REQUIRED_ENTERPRISE_TABLES) {
    if (!expectedShape.has(table)) expectedShape.set(table, new Set())
  }
  const requiredVpsColumns = expectedShape.get("vps_instances") || new Set<string>()
  for (const column of REQUIRED_VPS_INSTANCE_COLUMNS) requiredVpsColumns.add(column)
  expectedShape.set("vps_instances", requiredVpsColumns)

  const expectedTables = Array.from(expectedShape.keys()).sort()
  const [localMigrationNames, tableRows, columnRows, indexRows, foreignKeyRows, failedRows, appliedRows] = await Promise.all([
    readLocalMigrationNames(),
    queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    ` as Promise<Array<{ table_name: string }>>,
    queryRaw`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ` as Promise<Array<{ table_name: string; column_name: string }>>,
    fullPrismaShape
      ? queryRaw`
          SELECT
            t.relname AS table_name,
            i.relname AS index_name,
            ix.indisunique AS is_unique,
            array_agg(a.attname ORDER BY keys.ordinality) AS columns
          FROM pg_class t
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_index ix ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ordinality) ON true
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = keys.attnum
          WHERE n.nspname = 'public'
            AND t.relkind = 'r'
            AND ix.indisprimary = false
          GROUP BY t.relname, i.relname, ix.indisunique
        ` as Promise<Array<{ table_name: string; index_name: string; is_unique: boolean; columns: string[] }>>
      : Promise.resolve([]),
    fullPrismaShape
      ? queryRaw`
          SELECT
            source_table.relname AS table_name,
            target_table.relname AS referenced_table_name,
            array_agg(source_attribute.attname ORDER BY keys.ordinality) AS columns,
            array_agg(target_attribute.attname ORDER BY keys.ordinality) AS referenced_columns
          FROM pg_constraint constraint_row
          JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
          JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
          JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
          JOIN unnest(constraint_row.conkey, constraint_row.confkey) WITH ORDINALITY AS keys(source_attnum, target_attnum, ordinality) ON true
          JOIN pg_attribute source_attribute ON source_attribute.attrelid = source_table.oid AND source_attribute.attnum = keys.source_attnum
          JOIN pg_attribute target_attribute ON target_attribute.attrelid = target_table.oid AND target_attribute.attnum = keys.target_attnum
          WHERE constraint_row.contype = 'f'
            AND source_namespace.nspname = 'public'
          GROUP BY constraint_row.oid, source_table.relname, target_table.relname
        ` as Promise<Array<{ table_name: string; referenced_table_name: string; columns: string[]; referenced_columns: string[] }>>
      : Promise.resolve([]),
    (queryRaw`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    ` as Promise<Array<{ migration_name: string }>>).catch(() => []),
    (queryRaw`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ` as Promise<Array<{ migration_name: string }>>).catch(() => []),
  ])

  const existingTables = new Set(tableRows.map((row) => String(row.table_name)))
  const existingColumns = new Map<string, Set<string>>()
  for (const row of columnRows) {
    const table = String(row.table_name)
    const column = String(row.column_name)
    const columns = existingColumns.get(table) || new Set<string>()
    columns.add(column)
    existingColumns.set(table, columns)
  }

  const missingTables = expectedTables.filter((table) => !existingTables.has(table))
  const missingColumns: MissingColumn[] = []
  for (const [table, columns] of expectedShape.entries()) {
    if (missingTables.includes(table)) continue
    const existing = existingColumns.get(table) || new Set<string>()
    for (const column of Array.from(columns).sort()) {
      if (!existing.has(column)) missingColumns.push({ table, column })
    }
  }

  const missingIndexes: MissingIndex[] = []
  const existingIndexesByTable = new Map<string, Set<string>>()
  const existingUniqueIndexesByTable = new Map<string, Set<string>>()
  for (const row of indexRows) {
    const table = String(row.table_name)
    const signature = indexSignature((row.columns || []).map(String))
    const indexes = existingIndexesByTable.get(table) || new Set<string>()
    indexes.add(signature)
    existingIndexesByTable.set(table, indexes)
    if (row.is_unique) {
      const uniqueIndexes = existingUniqueIndexesByTable.get(table) || new Set<string>()
      uniqueIndexes.add(signature)
      existingUniqueIndexesByTable.set(table, uniqueIndexes)
    }
  }
  for (const expected of fullShape.indexes) {
    if (missingTables.includes(expected.table)) continue
    const existing = expected.kind === "unique" ? existingUniqueIndexesByTable.get(expected.table) : existingIndexesByTable.get(expected.table)
    if (!existing?.has(indexSignature(expected.columns))) missingIndexes.push(expected)
  }

  const existingForeignKeys = new Set(
    foreignKeyRows.map((row) => foreignKeySignature(
      String(row.table_name),
      (row.columns || []).map(String),
      String(row.referenced_table_name),
      (row.referenced_columns || []).map(String),
    )),
  )
  const missingForeignKeys = fullShape.foreignKeys.filter((expected) => {
    if (missingTables.includes(expected.table) || missingTables.includes(expected.referencedTable)) return false
    return !existingForeignKeys.has(foreignKeySignature(expected.table, expected.columns, expected.referencedTable, expected.referencedColumns))
  })

  const failedMigrations = failedRows.map((row) => String(row.migration_name)).filter(Boolean)
  const applied = new Set(appliedRows.map((row) => String(row.migration_name)))
  const pendingMigrations = localMigrationNames.filter((name) => !applied.has(name))

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0 && missingForeignKeys.length === 0 && failedMigrations.length === 0 && pendingMigrations.length === 0,
    checkedAt: new Date().toISOString(),
    missingTables,
    missingColumns,
    missingIndexes,
    missingForeignKeys,
    pendingMigrations,
    failedMigrations,
  }
}

export function formatSchemaHealthProblems(report: SchemaHealthReport) {
  return [
    ...report.missingTables.map((table) => `missing table: ${table}`),
    ...report.missingColumns.map((item) => `missing column: ${item.table}.${item.column}`),
    ...(report.missingIndexes || []).map((item) => `missing ${item.kind}: ${item.table}(${item.columns.join(", ")})`),
    ...(report.missingForeignKeys || []).map((item) => `missing foreign key: ${item.expected}`),
    ...report.pendingMigrations.map((name) => `pending migration: ${name}`),
    ...report.failedMigrations.map((name) => `failed migration: ${name}`),
  ]
}
