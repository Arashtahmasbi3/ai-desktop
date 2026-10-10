import { describe, expect, it } from 'vitest'
import {
  applyScaffold,
  detectTemplate,
  packageName,
  scaffoldFiles,
  scaffoldPromptHint,
  type ScaffoldFile
} from '@core/agent/project-scaffold'

describe('project scaffolding (v2.4 D.1)', () => {
  it('detects a template from a request (scenario 1)', () => {
    expect(detectTemplate('a small express api')).toBe('node-ts')
    expect(detectTemplate('a react dashboard')).toBe('react-vite')
    expect(detectTemplate('a fastapi service')).toBe('python')
    expect(detectTemplate('just a landing page')).toBe('static')
    expect(detectTemplate('something vague')).toBeUndefined()
  })

  it('scaffolds a node-ts project (scenario 2)', () => {
    const files = scaffoldFiles('node-ts', { name: 'My API', port: 4000 })
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content)
    expect(pkg.name).toBe('my-api')
    expect(files.some((f) => f.path === 'src/index.ts')).toBe(true)
    expect(files.find((f) => f.path === 'src/index.ts')!.content).toContain('4000')
  })

  it('scaffolds a react-vite project (scenario 3)', () => {
    const files = scaffoldFiles('react-vite', { name: 'dashboard' })
    expect(files.map((f) => f.path)).toEqual(['package.json', 'index.html', 'src/main.jsx'])
    expect(files[0]!.content).toContain('vite')
  })

  it('scaffolds python and static projects (scenario 4)', () => {
    expect(scaffoldFiles('python', { name: 'svc' }).map((f) => f.path)).toContain('requirements.txt')
    expect(scaffoldFiles('static', { name: 'site' })[0]!.path).toBe('index.html')
  })

  it('prompts the agent to scaffold (scenario 5)', () => {
    const hint = scaffoldPromptHint('node-ts')
    expect(hint).toContain('scaffold_project')
    expect(hint).toContain('node-ts')
    expect(packageName('  Hello World!! ')).toBe('hello-world')
  })

  it('never overwrites existing files (scenario 6)', async () => {
    const files: ScaffoldFile[] = [
      { path: 'package.json', content: '{}' },
      { path: 'src/index.ts', content: 'x' }
    ]
    const written: string[] = []
    const result = await applyScaffold(files, {
      exists: async (path) => path === 'package.json',
      write: async (path) => {
        written.push(path)
      }
    })
    expect(result.skipped).toEqual(['package.json'])
    expect(result.created).toEqual(['src/index.ts'])
    expect(written).toEqual(['src/index.ts'])
  })
})
