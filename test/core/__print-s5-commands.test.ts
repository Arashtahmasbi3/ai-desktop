import { it } from 'vitest'
import type { DatabaseJob } from '../../src/shared/database-migration'
import type { BringUpJob } from '../../src/shared/bring-up'
import type { MigrationEndpoint } from '../../src/shared/migration'
import { buildDatabaseSteps } from '../../src/core/tools/db-migrate-flow'
import { buildBringUpSteps } from '../../src/core/tools/bring-up-flow'

const SOURCE: MigrationEndpoint = {
  serverId: 'srv-spmotor',
  name: 'spmotor',
  host: '91.107.174.210',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}
const TARGET: MigrationEndpoint = {
  serverId: 'srv-yoserver',
  name: 'yoserver-spmotor',
  host: '212.16.86.23',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}

it('prints the S5 commands', () => {
  const db: DatabaseJob = {
    source: SOURCE,
    target: TARGET,
    container: 'zoonestore-postgres',
    database: 'zoonestore',
    user: 'postgres',
    dumpPath: '/var/tmp/ai-desktop-db/zoonestore.dump',
    sampleTables: 20
  }
  const lines: string[] = []
  for (const step of buildDatabaseSteps(db, 'relay', {
    localStagingDir: '/var/tmp/ai-desktop-migrate/212.16.86.23'
  })) {
    lines.push(`[${step.runner}/${step.where}] ${step.id}: ${step.command}`)
  }
  const bring: BringUpJob = {
    source: SOURCE,
    target: TARGET,
    projectPath: '/opt/zoonestore',
    domains: ['goldenmode2.com', 'zoonestore.ir'],
    certbotEmail: 'ops@goldenmode2.com',
    requiredEnvKeys: ['DATABASE_URL', 'NODE_ENV'],
    apiApp: 'zoonestore-api',
    webApp: 'zoonestore-web',
    apiPort: 3200,
    webPort: 3201,
    apiScript: 'start:api',
    webScript: 'start:web'
  }
  for (const step of buildBringUpSteps(bring, 'relay')) {
    lines.push(`[${step.runner}/${step.where}] ${step.id}: ${step.command}`)
  }
  console.log(lines.join('\n'))
})
