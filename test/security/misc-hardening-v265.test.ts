import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DockerSandboxDriver } from '@core/sandbox/docker-sandbox'
import type { CommandRunner } from '@core/sandbox/command-runner'
import type { ExecOptions, ExecResult } from '@shared/sandbox'
import { FileService } from '../../src/main/file-service'
import { GitHubClient, nextPagePath } from '../../src/main/github/client'
import { inspectSecretPath } from '@shared/secret-paths'

/** Records the argv it was asked to run and reports success. */
class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ file: string; args: string[] }> = []
  async run(file: string, args: string[], _options?: ExecOptions): Promise<ExecResult> {
    this.calls.push({ file, args })
    // `docker create` must print a container id.
    return { stdout: 'sha256:abc\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }
  }
}

let dir: string

beforeEach(async () => {
  dir = join(tmpdir(), `ai-desktop-misc-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('N-17: the sandbox image cannot become a docker flag', () => {
  it('refuses an image reference that starts with a dash', async () => {
    const runner = new RecordingRunner()
    const driver = new DockerSandboxDriver({ runner, dockerPath: 'docker' })
    await expect(
      driver.create({
        id: 'sbx-1',
        workspaceRoot: dir,
        limits: { cpus: 1, memoryMb: 128, pidsLimit: 64, diskMb: 64 },
        networkEnabled: false,
        env: {},
        image: '--network=host'
      } as never)
    ).rejects.toThrow(/Invalid sandbox image/)
  })

  it('passes a normal reference through and keeps the hardened flags', async () => {
    const runner = new RecordingRunner()
    const driver = new DockerSandboxDriver({ runner, dockerPath: 'docker' })
    await driver.create({
      id: 'sbx-2',
      workspaceRoot: dir,
      limits: { cpus: 1, memoryMb: 128, pidsLimit: 64, diskMb: 64 },
      networkEnabled: false,
      env: {},
      image: 'node:20-alpine'
    } as never)
    const args = runner.calls[0]!.args
    expect(args).toContain('node:20-alpine')
    expect(args.join(' ')).toContain('--network none')
    expect(args.join(' ')).toContain('--read-only')
  })
})

describe('N-18: a link inside the project cannot escape it', () => {
  it('refuses to read through a junction that points outside the root', async () => {
    const root = join(dir, 'project')
    const outside = join(dir, 'outside')
    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(join(outside, 'secret.txt'), 'top secret', 'utf8')

    let linked = true
    try {
      // A Windows junction needs no elevation; on POSIX this is a plain symlink.
      await fs.symlink(outside, join(root, 'link'), 'junction')
    } catch {
      linked = false
    }
    if (!linked) return

    const files = new FileService()
    files.setRoot(root)
    await expect(files.read('link/secret.txt')).rejects.toThrow(/escapes the project root/)
    // An ordinary in-project file still works.
    await fs.writeFile(join(root, 'ok.txt'), 'fine', 'utf8')
    expect(await files.read('ok.txt')).toBe('fine')
  })
})

describe('N-11: the GitHub client parses Link pagination and honours a timeout', () => {
  it('extracts the next page path and ignores the other rels', () => {
    const header =
      '<https://api.github.com/user/repos?per_page=30&page=2>; rel="next", ' +
      '<https://api.github.com/user/repos?per_page=30&page=9>; rel="last"'
    expect(nextPagePath(header, 'https://api.github.com')).toBe('/user/repos?per_page=30&page=2')
    expect(nextPagePath(null, 'https://api.github.com')).toBeNull()
    expect(
      nextPagePath('<https://api.github.com/x?page=1>; rel="prev"', 'https://api.github.com')
    ).toBeNull()
  })

  it('follows the next link across pages', async () => {
    const seen: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      seen.push(url)
      const page = new URL(url).searchParams.get('page') ?? '1'
      const headers =
        page === '1'
          ? { link: `<https://api.github.com/user/repos?per_page=30&page=2>; rel="next"` }
          : {}
      const body =
        page === '1'
          ? [{ full_name: 'me/a', name: 'a', owner: { login: 'me' } }]
          : [{ full_name: 'me/b', name: 'b', owner: { login: 'me' } }]
      return new Response(JSON.stringify(body), { status: 200, headers })
    }
    const client = new GitHubClient({
      fetchImpl: fetchImpl as never,
      timeoutMs: 1000
    })
    const repos = await client.listRepos()
    expect(repos.map((r) => r.fullName)).toEqual(['me/a', 'me/b'])
    expect(seen).toHaveLength(2)
  })

  it('reports a timeout instead of hanging', async () => {
    const fetchImpl = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const client = new GitHubClient({ fetchImpl: fetchImpl as never, timeoutMs: 30 })
    await expect(client.user()).rejects.toThrow(/timed out/)
  })

  it('explains a rate limit instead of a bare 403', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response('API rate limit exceeded', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }
      })
    const client = new GitHubClient({ fetchImpl: fetchImpl as never, timeoutMs: 1000 })
    await expect(client.user()).rejects.toThrow(/rate limit reached/)
  })
})

describe('N-21: system secret paths are matched after resolving dot segments', () => {
  it.each(['/etc/shadow', '../../../etc/shadow', 'etc/../etc/shadow', '/etc/./shadow'])(
    'blocks %s',
    (path) => {
      expect(inspectSecretPath(path).blocked).toBe(true)
    }
  )

  it('still allows an ordinary project file', () => {
    expect(inspectSecretPath('/srv/app/src/index.ts').blocked).toBe(false)
  })
})
