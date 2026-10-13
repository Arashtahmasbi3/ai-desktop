import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Loader2, Search } from 'lucide-react'
import type { GitHubRepo } from '@shared/github'
import { readPrefs, setRepoReview, writePrefs, type RepoReviewConfig } from '../lib/prefs'

/** Settings → Code Review: per-repo auto-review configuration. */
export default function SettingsCodeReview(): JSX.Element {
  const { t } = useTranslation()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [query, setQuery] = useState('')
  const [config, setConfig] = useState<RepoReviewConfig[]>(() =>
    readPrefs<RepoReviewConfig[]>('codereview.repos', [])
  )

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const status = await window.api.github.status()
        if (!active) return
        setConnected(status.connected)
        if (status.connected) {
          const list = await window.api.github.repos()
          if (active) setRepos(list)
        }
      } catch {
        if (active) setConnected(false)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const update = (repo: string, autoReview: boolean): void => {
    const next = setRepoReview(config, repo, autoReview)
    setConfig(next)
    writePrefs('codereview.repos', next)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? repos.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : repos
  }, [repos, query])

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <GitFork className="h-3.5 w-3.5" />
        {t('settings.codeReview')}
      </h3>
      <p className="text-2xs text-neutral-500">{t('settings.codeReviewHint')}</p>

      {loading ? (
        <p className="flex items-center gap-2 text-2xs text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('common.loading')}
        </p>
      ) : !connected ? (
        <p className="text-2xs text-neutral-600">{t('settings.codeReviewNoAuth')}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-bg-primary px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-neutral-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.searchRepos')}
              className="flex-1 bg-transparent text-xs text-neutral-200 outline-none"
            />
          </label>
          {filtered.length === 0 ? (
            <p className="text-2xs text-neutral-600">{t('settings.noRepos')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((repo) => {
                const entry = config.find((item) => item.repo === repo.fullName)
                const active = entry?.autoReview ?? false
                return (
                  <li
                    key={repo.fullName}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-xs text-neutral-200" dir="ltr">
                      {repo.fullName}
                    </span>
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-2xs text-neutral-400">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) => update(repo.fullName, event.target.checked)}
                        className="accent-accent"
                      />
                      {t('settings.autoReview')}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
