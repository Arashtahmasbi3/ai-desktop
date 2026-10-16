import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_WEBSITE_DECISION,
  readPrefs,
  upsertPermission,
  writePrefs,
  type WebsiteDecision,
  type WebsitePermission
} from '../lib/prefs'

const DECISIONS: WebsiteDecision[] = ['ask', 'allow', 'block']

/** Settings → Browser: per-website permissions, defaulting to "Always ask". */
export default function SettingsBrowser(): JSX.Element {
  const { t } = useTranslation()
  const [host, setHost] = useState('')
  const [permissions, setPermissions] = useState<WebsitePermission[]>(() =>
    readPrefs<WebsitePermission[]>('browser.permissions', [])
  )

  const update = (next: WebsitePermission[]): void => {
    setPermissions(next)
    writePrefs('browser.permissions', next)
  }

  const add = (): void => {
    if (!host.trim()) return
    update(upsertPermission(permissions, host, DEFAULT_WEBSITE_DECISION))
    setHost('')
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="brutal-label flex items-center gap-2">
        <Globe className="h-3.5 w-3.5" />
        {t('settings.browser')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.browserHint')}</p>

      <div className="flex items-center gap-2">
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
          placeholder={t('settings.websitePlaceholder')}
          dir="ltr"
          className="brutal-inset brutal-focus brutal-data flex-1 px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={add}
          disabled={!host.trim()}
          className="brutal-btn brutal-primary flex items-center gap-1 px-3 py-1 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('common.add')}
        </button>
      </div>

      {permissions.length === 0 ? (
        <p className="text-2xs text-fg-subtle">{t('settings.noPermissions')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {permissions.map((entry) => (
            <li
              key={entry.host}
              className="brutal-card flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="brutal-data truncate text-xs" dir="ltr">
                {entry.host}
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={entry.decision}
                  onChange={(event) =>
                    update(
                      upsertPermission(
                        permissions,
                        entry.host,
                        event.target.value as WebsiteDecision
                      )
                    )
                  }
                  aria-label={entry.host}
                  className="brutal-inset brutal-focus px-2 py-0.5 text-2xs text-fg"
                >
                  {DECISIONS.map((decision) => (
                    <option key={decision} value={decision}>
                      {t(`settings.website_${decision}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => update(permissions.filter((item) => item.host !== entry.host))}
                  title={t('common.remove')}
                  aria-label={t('common.remove')}
                  className="brutal-btn p-1 text-fg-muted hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
