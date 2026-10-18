/**
 * Database migration between VPS hosts (v2.4, B.1).
 *
 * Supports PostgreSQL (pg_dump/pg_restore), MySQL/MariaDB (mysqldump/mysql),
 * MongoDB (mongodump/mongorestore) and SQLite (file copy). It is a planner plus a
 * small executor driven entirely by injected `exec`/`transfer` so `core` stays
 * node-free and every step is testable without SSH.
 *
 * Security: passwords never appear on the command line — we rely on `~/.pgpass`,
 * `~/.my.cnf`, or an env var (`$MONGO_URI`) that the remote shell resolves. A
 * dry-run lists the steps, and the target is always backed up before a restore.
 */

import type { VpsExecResult } from '@shared/vps'
import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { shellQuote } from '@shared/shell-quote'

export type DbType = 'postgres' | 'mysql' | 'mongodb' | 'sqlite'

export interface DbEndpoint {
  type: DbType | string
  name: string
  user?: string
  host?: string
  port?: number
  /** For SQLite: absolute path of the database file. */
  path?: string
}

export interface DbMigrateParams {
  sourceVpsId: string
  sourceDb: DbEndpoint
  targetVpsId: string
  targetDb: DbEndpoint
  dryRun?: boolean
  /** Back up the target database before restoring (default true). */
  backupTarget?: boolean
}

export interface DbMigrateDeps {
  /** Run a command on a given server. */
  exec(serverId: string, command: string): Promise<VpsExecResult>
  /** Copy a file from one server to another (rsync/SFTP). */
  transfer(
    fromServerId: string,
    fromPath: string,
    toServerId: string,
    toPath: string
  ): Promise<{ ok: boolean; message?: string }>
  audit?(entry: { ok: boolean; detail: string }): Promise<void>
}

export interface DbMigrateResult {
  ok: boolean
  logs: string[]
  blocked?: boolean
  plan?: DbMigratePlan
}

export interface DbMigratePlan {
  dbType: DbType
  source: string
  target: string
  steps: string[]
  dumpPath: string
  backupPath?: string
  willOverwrite: boolean
}

const DUMP_EXTENSION: Record<DbType, string> = {
  postgres: 'dump',
  mysql: 'sql',
  mongodb: 'archive',
  sqlite: 'db'
}

/** Normalise a type string or connection URI into a known {@link DbType}. */
export function detectDbType(input: string): DbType | undefined {
  const value = input.toLowerCase()
  if (value.startsWith('postgres') || value.startsWith('postgresql')) return 'postgres'
  if (value.startsWith('mysql') || value.startsWith('mariadb')) return 'mysql'
  if (value.startsWith('mongodb')) return 'mongodb'
  if (value.startsWith('sqlite') || value.endsWith('.db') || value.endsWith('.sqlite')) return 'sqlite'
  if (value === 'postgres' || value === 'postgresql') return 'postgres'
  if (value === 'mysql' || value === 'mariadb') return 'mysql'
  if (value === 'mongodb') return 'mongodb'
  if (value === 'sqlite') return 'sqlite'
  return undefined
}

/** Tools that must exist on a host for a given database type. */
export function requiredTools(type: DbType): string[] {
  switch (type) {
    case 'postgres':
      return ['pg_dump', 'pg_restore']
    case 'mysql':
      return ['mysqldump', 'mysql']
    case 'mongodb':
      return ['mongodump', 'mongorestore']
    case 'sqlite':
      return []
  }
}

function hostArgs(db: DbEndpoint): string {
  const parts: string[] = []
  if (db.host) parts.push(`-h ${shellQuote(db.host)}`)
  if (db.port) parts.push(`-P ${db.port}`)
  if (db.user) parts.push(`-u ${shellQuote(db.user)}`)
  return parts.join(' ')
}

/** Dump command for the source database. Never contains a password. */
export function buildDumpCommand(type: DbType, db: DbEndpoint, outPath: string): string {
  const out = shellQuote(outPath)
  switch (type) {
    case 'postgres':
      return `pg_dump ${hostArgs(db)} -Fc -d ${shellQuote(db.name)} -f ${out}`
    case 'mysql':
      return `mysqldump ${hostArgs(db)} ${shellQuote(db.name)} > ${out}`
    case 'mongodb':
      // The connection string (with credentials) lives in the $MONGO_URI env var.
      return `mongodump --uri "$MONGO_URI" --archive=${out}`
    case 'sqlite':
      return `cp -p -- ${shellQuote(db.path ?? db.name)} ${out}`
  }
}

/** Restore command for the target database. Never contains a password. */
export function buildRestoreCommand(type: DbType, db: DbEndpoint, inPath: string): string {
  const input = shellQuote(inPath)
  switch (type) {
    case 'postgres':
      return `pg_restore --clean --if-exists ${hostArgs(db)} -d ${shellQuote(db.name)} ${input}`
    case 'mysql':
      return `mysql ${hostArgs(db)} ${shellQuote(db.name)} < ${input}`
    case 'mongodb':
      return `mongorestore --uri "$MONGO_URI" --drop --archive=${input}`
    case 'sqlite':
      return `cp -p -- ${input} ${shellQuote(db.path ?? db.name)}`
  }
}

/** A cheap post-restore sanity query per type (returns a single number). */
export function buildVerifyCommand(type: DbType, db: DbEndpoint): string {
  switch (type) {
    case 'postgres':
      return `psql ${hostArgs(db)} -d ${shellQuote(db.name)} -tAc "select count(*) from information_schema.tables"`
    case 'mysql':
      return `mysql ${hostArgs(db)} -N -B -e "select count(*) from information_schema.tables" ${shellQuote(db.name)}`
    case 'mongodb':
      return `mongosh "$MONGO_URI" --quiet --eval "db.stats().collections"`
    case 'sqlite':
      return `test -f ${shellQuote(db.path ?? db.name)} && echo ok`
  }
}

/** Warning-free summary a dry-run shows before anything is executed. */
export function planDbMigration(params: DbMigrateParams): DbMigratePlan {
  const type = detectDbType(params.sourceDb.type)
  if (!type) throw new Error(`Unsupported database type: ${params.sourceDb.type}`)
  const dumpPath = `/tmp/aidesk-${type}-${sanitize(params.sourceDb.name)}.${DUMP_EXTENSION[type]}`
  const steps = [
    `Check tools on source: ${requiredTools(type).join(', ') || 'none'}`,
    `Dump ${type} database "${params.sourceDb.name}" on ${params.sourceVpsId} -> ${dumpPath}`,
    `Transfer ${dumpPath} to ${params.targetVpsId}`,
    params.backupTarget === false
      ? 'Skip target backup (not recommended)'
      : `Back up target database "${params.targetDb.name}" first`,
    `Restore into "${params.targetDb.name}" on ${params.targetVpsId}`,
    `Verify and clean up`
  ]
  return {
    dbType: type,
    source: `${params.sourceVpsId}:${params.sourceDb.name}`,
    target: `${params.targetVpsId}:${params.targetDb.name}`,
    steps,
    dumpPath,
    ...(params.backupTarget === false
      ? {}
      : { backupPath: `/tmp/aidesk-backup-${sanitize(params.targetDb.name)}.${DUMP_EXTENSION[type]}` }),
    willOverwrite: true
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function firstOutput(result: VpsExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
}

/** Guarded entry point. Dry-run stops after planning; otherwise it runs the pipeline. */
export async function migrateDatabase(
  deps: DbMigrateDeps,
  params: DbMigrateParams
): Promise<DbMigrateResult> {
  const logs: string[] = []
  let plan: DbMigratePlan
  try {
    plan = planDbMigration(params)
  } catch (error) {
    return { ok: false, logs: [error instanceof Error ? error.message : String(error)] }
  }
  const type = plan.dbType
  logs.push(`Plan: ${plan.steps.length} step(s) for ${type}.`)

  if (params.dryRun === true) {
    logs.push(...plan.steps.map((step) => `- ${step}`))
    if (plan.willOverwrite) logs.push('⚠️ This will overwrite existing data on the target.')
    return { ok: true, logs, plan }
  }

  const fail = (message: string): DbMigrateResult => {
    logs.push(message)
    return { ok: false, logs }
  }

  // 1. Tools present on both hosts?
  for (const [serverId, label] of [
    [params.sourceVpsId, 'source'],
    [params.targetVpsId, 'target']
  ] as const) {
    for (const tool of requiredTools(type)) {
      const check = await deps.exec(serverId, `command -v ${tool} >/dev/null 2>&1 && echo ok`)
      if (!check.ok || !check.stdout.includes('ok')) {
        return fail(`Missing tool "${tool}" on ${label} (${serverId}).`)
      }
    }
  }

  // 2. Back up the target first (default on), so a failed restore can roll back.
  const backupPath = plan.backupPath
  if (backupPath) {
    const backup = await deps.exec(params.targetVpsId, buildDumpCommand(type, params.targetDb, backupPath))
    if (!backup.ok) return fail(`Target backup failed: ${firstOutput(backup) || 'unknown error'}`)
    logs.push(`Backed up target to ${backupPath}`)
  }

  // 3. Dump the source.
  const dump = await deps.exec(params.sourceVpsId, buildDumpCommand(type, params.sourceDb, plan.dumpPath))
  if (!dump.ok) return fail(`Source dump failed: ${firstOutput(dump) || 'unknown error'}`)
  logs.push(`Dumped source to ${plan.dumpPath}`)

  // 4. Transfer the dump.
  const moved = await deps.transfer(params.sourceVpsId, plan.dumpPath, params.targetVpsId, plan.dumpPath)
  if (!moved.ok) {
    await deps.exec(params.sourceVpsId, `rm -f ${shellQuote(plan.dumpPath)}`)
    return fail(`Transfer failed: ${moved.message ?? 'unknown error'}`)
  }
  logs.push(`Transferred ${plan.dumpPath}`)

  // 5. Restore on the target; on failure roll back from the backup.
  const restore = await deps.exec(params.targetVpsId, buildRestoreCommand(type, params.targetDb, plan.dumpPath))
  if (!restore.ok) {
    if (backupPath) {
      const rollback = await deps.exec(
        params.targetVpsId,
        buildRestoreCommand(type, params.targetDb, backupPath)
      )
      logs.push(rollback.ok ? 'Restore failed; rolled back from backup.' : 'Restore failed; rollback also failed.')
      await deps.audit?.({ ok: false, detail: `db restore failed; rollback ${rollback.ok ? 'ok' : 'failed'}` })
    }
    return fail(`Restore failed: ${firstOutput(restore) || 'unknown error'}`)
  }
  logs.push('Restored target database')

  // 6. Verify, then clean up temp files.
  const verify = await deps.exec(params.targetVpsId, buildVerifyCommand(type, params.targetDb))
  if (!verify.ok) return fail(`Verification failed: ${firstOutput(verify) || 'unknown error'}`)
  logs.push(`Verified target (${verify.stdout.trim() || 'ok'})`)

  await deps.exec(params.sourceVpsId, `rm -f ${shellQuote(plan.dumpPath)}`)
  await deps.exec(params.targetVpsId, `rm -f ${shellQuote(plan.dumpPath)}`)
  logs.push('Cleaned up temporary dump files')

  await deps.audit?.({ ok: true, detail: `migrated ${plan.source} -> ${plan.target} (${type})` })
  return { ok: true, logs, plan }
}

// --- v2.4.1: agent-facing tool + executor --------------------------------

export const dbMigrateTool: ToolDefinition = {
  name: 'migrate_database',
  description:
    'Migrate a database from one VPS to another. Supports postgres, mysql, ' +
    'mongodb and sqlite. Always dry-run first, then run again without dry_run ' +
    'to execute (the target is backed up before the restore).',
  parameters: {
    type: 'object',
    properties: {
      source_vps_id: { type: 'string' },
      source_db: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'postgres | mysql | mongodb | sqlite' },
          name: { type: 'string' },
          user: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'number' },
          path: { type: 'string', description: 'SQLite file path' }
        },
        required: ['type', 'name']
      },
      target_vps_id: { type: 'string' },
      target_db: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          name: { type: 'string' },
          user: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'number' },
          path: { type: 'string' }
        },
        required: ['type', 'name']
      },
      dry_run: { type: 'boolean' },
      backup_target: { type: 'boolean' }
    },
    required: ['source_vps_id', 'source_db', 'target_vps_id', 'target_db'],
    additionalProperties: false
  }
}

function parseEndpoint(raw: unknown): DbEndpoint | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : undefined
  const name = typeof obj.name === 'string' ? obj.name : undefined
  if (!type || !name) return undefined
  const endpoint: DbEndpoint = { type, name }
  if (typeof obj.user === 'string') endpoint.user = obj.user
  if (typeof obj.host === 'string') endpoint.host = obj.host
  if (typeof obj.port === 'number') endpoint.port = obj.port
  if (typeof obj.path === 'string') endpoint.path = obj.path
  return endpoint
}

export function parseDbMigrateArgs(args: Record<string, unknown>): DbMigrateParams | string {
  const sourceVpsId = typeof args.source_vps_id === 'string' ? args.source_vps_id.trim() : ''
  const targetVpsId = typeof args.target_vps_id === 'string' ? args.target_vps_id.trim() : ''
  const sourceDb = parseEndpoint(args.source_db)
  const targetDb = parseEndpoint(args.target_db)
  if (!sourceVpsId) return 'source_vps_id is required'
  if (!targetVpsId) return 'target_vps_id is required'
  if (!sourceDb) return 'source_db must have a type and name'
  if (!targetDb) return 'target_db must have a type and name'
  return {
    sourceVpsId,
    sourceDb,
    targetVpsId,
    targetDb,
    ...(args.dry_run === true ? { dryRun: true } : {}),
    ...(args.backup_target === false ? { backupTarget: false } : {})
  }
}

/** Bridges the agent's `migrate_database` action to the migration pipeline. */
export class DbMigrateToolExecutor implements ToolExecutor {
  constructor(private readonly deps: DbMigrateDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
    if (action.name !== dbMigrateTool.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'migrate_database received malformed arguments',
        code: 'invalid_arguments'
      }
    }
    const parsed = parseDbMigrateArgs(action.arguments)
    if (typeof parsed === 'string') {
      return { ...base, ok: false, output: '', error: parsed, code: 'invalid_arguments' }
    }
    const result = await migrateDatabase(this.deps, parsed)
    return {
      ...base,
      ok: result.ok,
      output: result.logs.join('\n'),
      ...(result.ok ? {} : { error: result.logs.join('\n'), code: 'remote_error' as const }),
      durationMs: Date.now() - startedAt
    }
  }
}
