import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Laptop, Server, ShieldAlert, ShieldCheck, Smartphone, Terminal } from 'lucide-react'
import { readPrefs, writePrefs } from '../lib/prefs'
import { useStore } from '../store'
import HostPolicyEditor from './Vps/HostPolicyEditor'
import SshConfigImport from './SshConfigImport'

type ConnectionTab = 'pc' | 'devices' | 'ssh'

/**
 * Diagnostic Mode toggle (v2.5.3). Read-only widening of the P0-2 confinement
 * for crash investigation; the main process owns the actual policy and expiry.
 */
function DiagnosticModeSection(): JSX.Element {
  const { t } = useTranslation()
  const diagnostic = useStore((state) => state.diagnostic)
  const refreshDiagnostic = useStore((state) => state.refreshDiagnostic)
  const setDiagnosticMode = useStore((state) => state.setDiagnosticMode)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void refreshDiagnostic()
  }, [refreshDiagnostic])

  // Tick while active so the countdown stays honest and flips to OFF on expiry.
  useEffect(() => {
    if (!diagnostic?.active) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [diagnostic?.active])

  const active = Boolean(diagnostic?.active)
  const expiresAt = diagnostic?.expiresAt ?? 0
  const remainingMin = active ? Math.max(0, Math.ceil((expiresAt - now) / 60_000)) : 0
  const paths = diagnostic?.allowedPaths ?? []

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-primary p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-fg">
            {active ? (
              <ShieldCheck className="h-4 w-4 text-warning" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-fg-muted" />
            )}
            {t('settings.diagnosticTitle')}
          </p>
          <p className="mt-0.5 text-2xs text-fg-muted">
            {active ? t('settings.diagnosticOn') : t('settings.diagnosticOff')}
            {active && remainingMin > 0
              ? ` · ${t('settings.diagnosticRemaining', { minutes: remainingMin })}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void setDiagnosticMode(!active)}
          className={`shrink-0 rounded px-2.5 py-1 text-2xs transition ${
            active
              ? 'border border-warning/40 text-warning hover:bg-warning/10'
              : 'bg-accent-solid text-white hover:bg-accent-solid-hover'
          }`}
        >
          {active ? t('settings.diagnosticDisable') : t('settings.diagnosticEnable')}
        </button>
      </div>
      <p className="text-2xs leading-relaxed text-fg-muted">{t('settings.diagnosticDesc')}</p>
      {active && paths.length > 0 ? (
        <p className="break-all text-2xs text-fg-subtle">
          {t('settings.diagnosticPaths')}: <span className="font-mono">{paths.join(', ')}</span>
        </p>
      ) : null}
    </div>
  )
}

/** Settings → Connections: this PC, other devices and SSH/VPS. */
export default function SettingsConnections(): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ConnectionTab>('pc')
  const [pcEnabled, setPcEnabled] = useState(() => readPrefs<boolean>('conn.pc', true))
  const setView = useStore((state) => state.setView)
  const toggleTerminal = useStore((state) => state.toggleTerminal)
  const closeSettings = useStore((state) => state.closeSettings)
  const projects = useStore((state) => state.settings?.projects ?? [])
  const vpsServers = useStore((state) => state.vpsServers)
  const sshCount = projects.filter((project) => project.vpsId).length

  const tabs: Array<{ id: ConnectionTab; labelKey: string; icon: typeof Laptop }> = [
    { id: 'pc', labelKey: 'settings.connPc', icon: Laptop },
    { id: 'devices', labelKey: 'settings.connDevices', icon: Smartphone },
    { id: 'ssh', labelKey: 'settings.connSsh', icon: Server }
  ]

  const togglePc = (): void => {
    const next = !pcEnabled
    setPcEnabled(next)
    writePrefs('conn.pc', next)
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <Server className="h-3.5 w-3.5" />
        {t('settings.connections')}
      </h3>

      <div className="flex items-center gap-1">
        {tabs.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${
                tab === item.id
                  ? 'bg-accent-solid/15 text-accent'
                  : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>

      {tab === 'pc' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-fg">
              <span
                className={`h-1.5 w-1.5 rounded-full ${pcEnabled ? 'bg-success' : 'bg-bg-tertiary'}`}
              />
              {t('settings.thisPc')}
            </p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              {pcEnabled ? t('settings.thisPcOn') : t('settings.thisPcOff')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setView('chat')
                closeSettings()
                toggleTerminal()
              }}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-2xs text-fg hover:bg-bg-tertiary"
            >
              <Terminal className="h-3.5 w-3.5" />
              {t('settings.openTerminal')}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={pcEnabled}
              aria-label={t('settings.thisPc')}
              onClick={togglePc}
              className={`relative h-4 w-8 rounded-full transition ${
                pcEnabled ? 'bg-accent-solid' : 'bg-bg-tertiary'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                  pcEnabled ? 'left-4' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'devices' ? (
        <div className="rounded-xl border border-border bg-bg-primary p-4 text-center">
          <Smartphone className="mx-auto h-5 w-5 text-fg-subtle" />
          <p className="mt-2 text-xs text-fg-muted">{t('settings.noDevices')}</p>
          <p className="mt-0.5 text-2xs text-fg-subtle">{t('settings.noDevicesHint')}</p>
        </div>
      ) : null}

      {tab === 'ssh' ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-fg-muted">{t('onboarding.vpsBody')}</p>
          <p className="text-2xs text-fg-muted">
            {t('settings.sshProjects')}: {sshCount}
          </p>
          <SshConfigImport />
          <DiagnosticModeSection />
          <div className="flex flex-col gap-2">
            {vpsServers.length === 0 ? (
              <p className="text-2xs text-fg-subtle">{t('settings.hostPolicyNone')}</p>
            ) : (
              vpsServers.map((server) => <HostPolicyEditor key={server.id} server={server} />)
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setView('vps')
              closeSettings()
            }}
            className="w-fit rounded bg-accent-solid px-3 py-1.5 text-xs text-white hover:bg-accent-solid-hover"
          >
            {t('sidebar.navVps')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
