import { useState } from 'react'
import { GitBranch, X } from 'lucide-react'
import type { GitProjectType, GitSetupOptions } from '@shared/workspace-info'
import { buildGitSetupCommands } from '@core/remote/git-setup'

interface Props {
  serverId: string
  path: string
  /** Suggested type from the detected project files. */
  detectedType?: GitProjectType
  onClose: () => void
  onDone?: () => void
}

/**
 * v2.3.3 (B.1): "Setup Git?" dialog shown when a new remote project is not a
 * repo. Every command is previewed before it runs, and Skip closes silently.
 */
export default function GitSetupDialog({
  serverId,
  path,
  detectedType,
  onClose,
  onDone
}: Props): JSX.Element {
  const [init, setInit] = useState(true)
  const [gitignore, setGitignore] = useState(true)
  const [commit, setCommit] = useState(true)
  const [push, setPush] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [projectType, setProjectType] = useState<GitProjectType>(detectedType ?? 'generic')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)

  const options: GitSetupOptions = {
    init,
    gitignore,
    commit,
    projectType,
    ...(push && remoteUrl.trim() ? { push: true, remoteUrl: remoteUrl.trim() } : {})
  }
  const preview = buildGitSetupCommands(path, options)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.vps.gitSetup(serverId, path, options)
      setOutput(result.output || 'Done.')
      onDone?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const rowClass = 'flex items-center gap-2 text-xs text-neutral-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-2rem)] w-[min(32rem,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-neutral-200">
            <GitBranch className="h-4 w-4 text-accent" />
            Setup Git for this project?
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="truncate text-[11px] text-neutral-500">{path}</p>

          <label className={rowClass}>
            <input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} />
            git init
          </label>
          <label className={rowClass}>
            <input
              type="checkbox"
              checked={gitignore}
              onChange={(e) => setGitignore(e.target.checked)}
            />
            Create .gitignore
          </label>
          {gitignore ? (
            <select
              value={projectType}
              onChange={(e) => setProjectType(e.target.value as GitProjectType)}
              className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200"
            >
              <option value="node">Node</option>
              <option value="python">Python</option>
              <option value="generic">Generic</option>
            </select>
          ) : null}
          <label className={rowClass}>
            <input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} />
            Initial commit
          </label>
          <label className={rowClass}>
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
            Push to remote
          </label>
          {push ? (
            <input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="git@github.com:org/repo.git"
              className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200"
            />
          ) : null}

          {preview.length > 0 ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-primary p-2 text-[10px] text-neutral-500">
              {preview.join('\n')}
            </pre>
          ) : null}

          {error ? <p className="text-xs text-red-400">{error}</p> : null}
          {output ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-primary p-2 text-[10px] text-emerald-400">
              {output}
            </pre>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1 text-xs text-neutral-400 hover:bg-bg-tertiary"
            >
              Skip
            </button>
            <button
              type="button"
              disabled={busy || preview.length === 0}
              onClick={() => void run()}
              className="rounded bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30 disabled:opacity-50"
            >
              {busy ? 'Setting up…' : 'Set up Git'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
