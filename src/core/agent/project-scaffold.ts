/**
 * Project scaffolding (v2.4, D.1).
 *
 * Turns a one-line request ("a small express API") into a concrete set of starter
 * files. Pure and synchronous so it can be planned, previewed and tested; the caller
 * decides how files are written (local or over SSH).
 */

export type ScaffoldTemplate = 'node-ts' | 'react-vite' | 'python' | 'static'

export interface ScaffoldOptions {
  name: string
  port?: number
}

export interface ScaffoldFile {
  path: string
  content: string
}

/** Best-effort template detection from a free-text request. */
export function detectTemplate(description: string): ScaffoldTemplate | undefined {
  const text = description.toLowerCase()
  if (/\breact\b|\bvite\b|\bnext\b|\bfrontend\b|\bui\b|\bاسپا\b/.test(text)) return 'react-vite'
  if (/\bpython\b|\bflask\b|\bfastapi\b|\bdjango\b|\bپایتون\b/.test(text)) return 'python'
  if (/\bstatic\b|\bhtml\b|\blanding\b|\bسایت ساده\b/.test(text)) return 'static'
  if (/\bnode\b|\bexpress\b|\bapi\b|\btypescript\b|\bts\b|\bبکند\b/.test(text)) return 'node-ts'
  return undefined
}

/** Ask the agent to scaffold when a request looks like a new project. */
export function scaffoldPromptHint(template: ScaffoldTemplate): string {
  return (
    `The user wants to start a new project. Prefer the "${template}" scaffold: ` +
    'use scaffold_project to create the starter files, then run the install command ' +
    'and report the result. Do not overwrite existing files without asking.'
  )
}

export function packageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'
}

export function scaffoldFiles(template: ScaffoldTemplate, options: ScaffoldOptions): ScaffoldFile[] {
  const name = packageName(options.name)
  const port = options.port ?? 3000
  switch (template) {
    case 'node-ts':
      return [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name,
              private: true,
              type: 'module',
              scripts: { dev: 'tsx watch src/index.ts', start: 'node dist/index.js' },
              dependencies: { express: '^4.19.2' },
              devDependencies: { typescript: '^5.4.0', tsx: '^4.7.0', '@types/express': '^4.17.21' }
            },
            null,
            2
          )
        },
        {
          path: 'src/index.ts',
          content:
            "import express from 'express'\n\n" +
            `const app = express()\napp.get('/health', (_req, res) => res.json({ ok: true }))\n\n` +
            `app.listen(${port}, () => console.log('listening on http://localhost:${port}'))\n`
        }
      ]
    case 'react-vite':
      return [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name,
              private: true,
              type: 'module',
              scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
              dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
              devDependencies: { vite: '^5.2.0', '@vitejs/plugin-react': '^4.2.1' }
            },
            null,
            2
          )
        },
        { path: 'index.html', content: `<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n` },
        {
          path: 'src/main.jsx',
          content:
            "import React from 'react'\nimport { createRoot } from 'react-dom/client'\n\n" +
            "createRoot(document.getElementById('root')).render(<h1>" +
            name +
            '</h1>)\n'
        }
      ]
    case 'python':
      return [
        { path: 'requirements.txt', content: 'fastapi==0.111.0\nuvicorn==0.30.0\n' },
        {
          path: 'app.py',
          content:
            'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n' +
            "@app.get('/health')\ndef health():\n    return {'ok': True}\n"
        }
      ]
    case 'static':
      return [
        {
          path: 'index.html',
          content: `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>${name}</title></head>\n  <body><h1>${name}</h1></body>\n</html>\n`
        }
      ]
  }
}

/** Write the scaffolded files, refusing to overwrite anything that exists. */
export async function applyScaffold(
  files: ScaffoldFile[],
  deps: { exists(path: string): Promise<boolean>; write(path: string, content: string): Promise<void> }
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = []
  const skipped: string[] = []
  for (const file of files) {
    if (await deps.exists(file.path)) {
      skipped.push(file.path)
      continue
    }
    await deps.write(file.path, file.content)
    created.push(file.path)
  }
  return { created, skipped }
}
