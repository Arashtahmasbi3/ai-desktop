import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import type { SshConfigHost, VpsAuthType } from '@shared/vps'
import { useStore } from '../store'

/**
 * Settings → Connections → SSH: import hosts from `~/.ssh/config` (v2.3.2, B.5).
 * Only connection metadata is imported; private key contents are never read.
 */
export default function SshConfigImport(): JSX.Element {
  const { t } = useTranslation()
  const refreshVps = useStore((state) => state.refreshVps)
  const pushToast = useStore((state) => state.pushToast)
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      setHosts(await window.api.vps.importSshConfig())
    } catch {
      pushToast('error', t('settings.sshImportError'))
    } finally {
      setBusy(false)
    }
  }

  const add = async (host: SshConfigHost): Promise<void> => {
    const authType: VpsAuthType = host.identityFile ? 'key' : 'password'
    try {
      await window.api.vps.save({
        name: host.alias,
        host: host.hostName,
        port: host.port,
        username: host.user ?? '',
        authType,
        ...(host.identityFile ? { privateKeyPath: host.identityFile } : {})
      })
      await refreshVps()
      pushToast('success', t('settings.sshImportAdded', { name: host.alias }))
      setHosts((current) => current?.filter((item) => item.alias !== host.alias) ?? null)
    } catch {
      pushToast('error', t('settings.sshImportError'))
    }
  }

  const skip = (alias: string): void => {
    setHosts((current) => current?.filter((host) => host.alias !== alias) ?? null)
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="flex w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-bg-tertiary disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {t('settings.sshImport')}
      </button>

      {hosts ? (
        hosts.length === 0 ? (
          <p className="text-2xs text-neutral-600">{t('settings.sshImportEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {hosts.map((host) => (
              <li
                key={host.alias}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-primary px-3 py-2"
              >
                <div className="min-w-0 text-xs">
                  <p className="truncate text-neutral-200">{host.alias}</p>
                  <p className="truncate text-3xs text-neutral-500" dir="ltr">
                    {host.user ? `${host.user}@` : ''}
                    {host.hostName}
                    {host.port ? `:${host.port}` : ''}
                    {host.identityFile ? ` · ${host.identityFile}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void add(host)}
                    className="rounded bg-accent px-2 py-1 text-2xs text-white hover:bg-accent-hover"
                  >
                    {t('settings.sshImportAdd')}
                  </button>
                  <button
                    type="button"
                    onClick={() => skip(host.alias)}
                    title={t('settings.sshImportSkip')}
                    aria-label={t('settings.sshImportSkip')}
                    className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
