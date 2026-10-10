import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RunStore, DEFAULT_RUN_TTL_MS } from '@core/agent/run-store'
import { FileService } from '../../src/main/file-service'

/**
 * P0-1: Project Run Isolation. These tests exercise the real enforcement code
 * (`RunStore` + `FileService`) against real temp directories, so a regression
 * that lets a patch leak across projects or overwrite an externally-changed
 * file fails here.
 */
let base: string
let rootA: string
let rootB: string
let io: FileService

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

async function read(root: string, path: string): Promise<string> {
  return fs.readFile(join(root, path), 'utf8')
}

async function write(root: string, path: string, content: string): Promise<void> {
  await fs.writeFile(join(root, path), content, 'utf8')
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'run-isolation-'))
  rootA = join(base, PROJECT_A)
  rootB = join(base, PROJECT_B)
  await fs.mkdir(rootA, { recursive: true })
  await fs.mkdir(rootB, { recursive: true })
  io = new FileService()
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('P0-1 Project Run Isolation', () => {
  it('applies a patch when the active project still matches the run', async () => {
    await write(rootA, 'app.ts', 'const v = 0\n')
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })

    const { before } = await store.capturePatch({
      runId: 'run-a',
      path: 'app.ts',
      fallbackBefore: '',
      io
    })
    expect(before).toBe('const v = 0\n')

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'const v = 1\n',
      io
    })

    expect(result).toEqual({ ok: true })
    expect(await read(rootA, 'app.ts')).toBe('const v = 1\n')
  })

  it('rejects a patch when the user switched to another project', async () => {
    await write(rootA, 'app.ts', 'A-version\n')
    await write(rootB, 'app.ts', 'B-version\n')
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_B,
      path: 'app.ts',
      content: 'patched\n',
      io
    })

    expect(result).toMatchObject({ ok: false, reason: 'project-changed' })
    expect(await read(rootA, 'app.ts')).toBe('A-version\n')
    expect(await read(rootB, 'app.ts')).toBe('B-version\n')
  })

  it('rejects a patch when the target file changed externally', async () => {
    await write(rootA, 'app.ts', 'v0\n')
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })

    await write(rootA, 'app.ts', 'v1-external\n')

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'patch\n',
      io
    })

    expect(result).toMatchObject({ ok: false, reason: 'file-changed' })
    expect(await read(rootA, 'app.ts')).toBe('v1-external\n')
  })

  it('allows several patches on the same file within one run', async () => {
    await write(rootA, 'app.ts', 'v0\n')
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })

    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })
    const first = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'v1\n',
      io
    })
    expect(first).toEqual({ ok: true })

    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })
    const second = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'v2\n',
      io
    })
    expect(second).toEqual({ ok: true })
    expect(await read(rootA, 'app.ts')).toBe('v2\n')
  })

  it('rejects a stale run created more than 30 minutes ago', async () => {
    await write(rootA, 'app.ts', 'v0\n')
    let now = 1_000_000
    const store = new RunStore({ now: () => now })
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })

    now += DEFAULT_RUN_TTL_MS + 1

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'patch\n',
      io
    })

    expect(result).toMatchObject({ ok: false, reason: 'run-expired' })
    expect(await read(rootA, 'app.ts')).toBe('v0\n')
  })

  it('writes into the run root, not the live file-service root', async () => {
    await write(rootA, 'app.ts', 'v0\n')
    await write(rootB, 'app.ts', 'B-version\n')
    io.setRoot(rootB) // live root points at another project
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: 'app.ts', fallbackBefore: '', io })

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'v1\n',
      io
    })

    expect(result).toEqual({ ok: true })
    expect(await read(rootA, 'app.ts')).toBe('v1\n')
    expect(await read(rootB, 'app.ts')).toBe('B-version\n')
  })

  it('refuses to clobber a new file that appeared after capture', async () => {
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: 'new.ts', fallbackBefore: '', io })

    await write(rootA, 'new.ts', 'created-externally\n')

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: 'new.ts',
      content: 'patch\n',
      io
    })

    expect(result).toMatchObject({ ok: false, reason: 'file-changed' })
    expect(await read(rootA, 'new.ts')).toBe('created-externally\n')
  })

  it('rejects an unknown run', async () => {
    const store = new RunStore()
    const result = await store.applyPatch({
      runId: 'missing',
      activeProjectId: PROJECT_A,
      path: 'app.ts',
      content: 'patch\n',
      io
    })
    expect(result).toMatchObject({ ok: false, reason: 'run-not-found' })
  })

  it('cannot escape the run root via a traversal path', async () => {
    await write(base, 'outside.txt', 'secret\n')
    const store = new RunStore()
    store.createRun({ id: 'run-a', projectId: PROJECT_A, projectRoot: rootA })
    await store.capturePatch({ runId: 'run-a', path: '../outside.txt', fallbackBefore: '', io })

    const result = await store.applyPatch({
      runId: 'run-a',
      activeProjectId: PROJECT_A,
      path: '../outside.txt',
      content: 'owned\n',
      io
    })

    expect(result).toMatchObject({ ok: false })
    expect(await read(base, 'outside.txt')).toBe('secret\n')
  })

  it('tracks run status across its lifecycle', () => {
    const store = new RunStore()
    const run = store.createRun({ projectId: PROJECT_A, projectRoot: rootA })
    expect(run.status).toBe('running')
    store.markCompleted(run.id)
    expect(store.getRun(run.id)?.status).toBe('completed')
    store.markAborted(run.id)
    expect(store.getRun(run.id)?.status).toBe('aborted')
  })
})
