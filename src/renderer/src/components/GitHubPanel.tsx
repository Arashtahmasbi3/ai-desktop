import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDot,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Loader2,
  RefreshCw
} from 'lucide-react'
import type { GitRepoStatus, GitHubIssue, GitHubPull, GitHubRepo } from '@shared/github'
import { useStore } from '../store'

type Tab = 'status' | 'pulls' | 'issues'

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** GitHub view: local git status/actions plus repository PRs and issues. */
export default function GitHubPanel(): JSX.Element {
  const settings = useStore((state) => state.settings)
  const active = settings?.projects.find((project) => project.id === settings.activeProjectId)
  const cwd = active?.path

  const [tab, setTab] = useState<Tab>('status')
  const [status, setStatus] = useState<GitRepoStatus | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [repo, setRepo] = useState('')
  const [pulls, setPulls] = useState<GitHubPull[]>([])
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [message, setMessage] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!cwd) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.github.gitStatus(cwd))
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }, [cwd])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const runGit = async (op: () => Promise<{ ok: boolean; output: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await op()
      setOutput(result.output || (result.ok ? 'Done.' : 'Failed.'))
      if (!result.ok) setError('Git command failed')
      await refreshStatus()
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }

  const loadRepos = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const list = await window.api.github.repos()
      setRepos(list)
      if (!repo && list[0]) setRepo(list[0].fullName)
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }

  const loadTab = async (): Promise<void> => {
    const [owner, name] = repo.split('/')
    if (!owner || !name) {
      setError('Choose a repository first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (tab === 'pulls') setPulls(await window.api.github.pulls(owner, name))
      else setIssues(await window.api.github.issues(owner, name))
    } catch (cause) {
      setError(text(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        {(
          [
            ['status', 'Status', GitBranch],
            ['pulls', 'Pull requests', GitPullRequest],
            ['issues', 'Issues', CircleDot]
          ] as Array<[Tab, string, typeof GitBranch]>
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-2xs ${
              tab === id ? 'bg-accent-solid/20 text-accent' : 'text-fg-muted hover:bg-bg-tertiary'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => (tab === 'status' ? void refreshStatus() : void loadTab())}
          disabled={busy}
          className="ml-auto rounded p-1 text-fg-muted hover:bg-bg-tertiary disabled:opacity-40"
          title="Refresh"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-3 py-1 text-2xs text-danger">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {tab === 'status' ? (
          !cwd ? (
            <p className="text-fg-muted">Open a project to see its git status.</p>
          ) : !status?.isRepo ? (
            <p className="text-fg-muted">
              {status?.error ?? 'This project is not a git repository yet.'}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-fg">
                <GitBranch className="h-3.5 w-3.5 text-accent" />
                <span className="font-medium">{status.branch || '(detached)'}</span>
                {status.ahead > 0 ? <span className="text-success">↑{status.ahead}</span> : null}
                {status.behind > 0 ? <span className="text-warning">↓{status.behind}</span> : null}
                <span className="text-fg-subtle">{status.clean ? 'clean' : `${status.files.length} changed`}</span>
              </div>

              {status.files.length > 0 ? (
                <ul className="max-h-40 overflow-auto rounded border border-border font-mono text-2xs">
                  {status.files.map((file) => (
                    <li key={file.path} className="flex gap-2 px-2 py-0.5">
                      <span className="text-warning">{file.index}{file.workingDir}</span>
                      <span className="truncate text-fg" dir="ltr">{file.path}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex gap-2">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Commit message"
                  className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-2xs text-fg outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  disabled={busy || !message.trim()}
                  onClick={() =>
                    void runGit(() => window.api.github.gitCommit(cwd, { message, all: true }))
                  }
                  className="flex items-center gap-1 rounded bg-accent-solid px-2 py-1 text-white hover:bg-accent-solid-hover disabled:opacity-40"
                >
                  <GitCommitHorizontal className="h-3 w-3" /> Commit
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runGit(() => window.api.github.gitPull(cwd))}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-fg hover:bg-bg-tertiary disabled:opacity-40"
                >
                  <ArrowDownToLine className="h-3 w-3" /> Pull
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runGit(() => window.api.github.gitPush(cwd))}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-fg hover:bg-bg-tertiary disabled:opacity-40"
                >
                  <ArrowUpFromLine className="h-3 w-3" /> Push
                </button>
              </div>

              {output ? (
                <pre className="max-h-40 overflow-auto rounded bg-bg-tertiary p-2 font-mono text-3xs text-fg-muted">
                  {output}
                </pre>
              ) : null}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                placeholder="owner/repo"
                dir="ltr"
                className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-2xs text-fg outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void loadRepos()}
                className="rounded border border-border px-2 py-1 text-fg hover:bg-bg-tertiary"
              >
                My repos
              </button>
            </div>
            {repos.length > 0 ? (
              <select
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-2xs text-fg"
              >
                {repos.map((entry) => (
                  <option key={entry.fullName} value={entry.fullName}>
                    {entry.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <p className="flex items-center gap-1 text-fg-subtle">
                <GitFork className="h-3 w-3" /> Connect GitHub in Settings to list your repositories.
              </p>
            )}

            <ul className="space-y-1">
              {(tab === 'pulls' ? pulls : issues).map((entry) => (
                <li key={entry.number} className="rounded border border-border px-2 py-1.5">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg hover:text-accent"
                  >
                    #{entry.number} {entry.title}
                  </a>
                  <div className="mt-0.5 flex gap-2 text-3xs text-fg-subtle">
                    <span>@{entry.author}</span>
                    <span>{entry.state}</span>
                    {'draft' in entry && entry.draft ? <span>draft</span> : null}
                    {'comments' in entry ? <span>{entry.comments} comments</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
