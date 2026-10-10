import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore, createJobStore, sanitizeJobs } from '@main/job-store'
import type { Job } from '@shared/jobs'

const sample: Job = {
  id: 'job-1',
  command: 'npm install',
  vpsId: 'vps1',
  status: 'running',
  strategy: 'tmux',
  startedAt: 1000,
  output: '',
  sessionName: 'aidesk-job-1'
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aidesk-jobs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sanitizeJobs', () => {
  it('drops malformed records but keeps valid ones', () => {
    const result = sanitizeJobs([sample, { id: 'x' }, null, 'nope', { ...sample, status: 'bogus' }])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('job-1')
  })

  it('returns an empty array for non-arrays', () => {
    expect(sanitizeJobs(undefined)).toEqual([])
    expect(sanitizeJobs({})).toEqual([])
  })

  it('normalises missing optional output', () => {
    const result = sanitizeJobs([{ ...sample, output: undefined }])
    expect(result[0]?.output).toBe('')
  })
})

describe('JobStore', () => {
  it('round-trips jobs through disk', async () => {
    const store = createJobStore(dir)
    await store.save([sample])
    const loaded = await store.load()
    expect(loaded).toEqual([sample])
  })

  it('returns [] when the file is missing', async () => {
    const store = new JobStore(join(dir, 'missing.json'))
    expect(await store.load()).toEqual([])
  })

  it('returns [] for corrupt JSON', async () => {
    const file = join(dir, 'jobs.json')
    await writeFile(file, '{not json', 'utf8')
    expect(await new JobStore(file).load()).toEqual([])
  })
})
