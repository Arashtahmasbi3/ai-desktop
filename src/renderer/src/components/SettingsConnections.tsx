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
    <div className="ui-card flex flex-col gap-2 p-3">
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
          <p className="ui-data mt-0.5 text-2xs text-fg-muted">
            {active ? t('settings.diagnosticOn') : t('settings.diagnosticOff')}
            {active && remainingMin > 0
              ? ` · ${t('settings.diagnosticRemaining', { minutes: remainingMin })}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void setDiagnosticMode(!active)}
          className={`ui-btn shrink-0 ${
            active ? 'border-warning text-warning' : 'ui-primary'
          }`}
        >
          {active ? t('settings.diagnosticDisable') : t('settings.diagnosticEnable')}
        </button>
      </div>
      <p className="text-2xs leading-relaxed text-fg-muted">{t('settings.diagnosticDesc')}</p>
      {active && paths.length > 0 ? (
        <p className="break-all text-2xs text-fg-subtle">
          {t('settings.diagnosticPaths')}: <span className="ui-data">{paths.join(', ')}</span>
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
  // Checklist item 13: this button opens the local terminal, an advanced pane. Offering it in
  // simple mode would be a button that does nothing (the store refuses the pane there).
  const advanced = useStore((state) => state.uiMode === 'advanced')
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
      <h3 className="ui-label flex items-center gap-2">
        <Server className="h-3.5 w-3.5" />
        {t('settings.connections')}
      </h3>

      <div className="ui-inset flex w-fit items-center gap-1 p-0.5">
        {tabs.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              data-selected={tab === item.id}
              className="ui-tab flex items-center gap-1.5 px-2.5 py-1"
            >
              <Icon className="h-3.5 w-3.5" />
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>

      {tab === 'pc' ? (
        <div className="ui-card flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-fg">
              <span
                className={`h-1.5 w-1.5 rounded-shape-pill ${pcEnabled ? 'bg-success' : 'bg-bg-tertiary'}`}
              />
              {t('settings.thisPc')}
            </p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              {pcEnabled ? t('settings.thisPcOn') : t('settings.thisPcOff')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {advanced ? (
              <button
                type="button"
                onClick={() => {
                  setView('chat')
                  closeSettings()
                  toggleTerminal()
                }}
                className="ui-btn flex items-center gap-1"
              >
                <Terminal className="h-3.5 w-3.5" />
                {t('settings.openTerminal')}
              </button>
            ) : null}
            {/* A square switch: the track carries the state, the ink block is the knob. */}
            <button
              type="button"
              role="switch"
              aria-checked={pcEnabled}
              aria-label={t('settings.thisPc')}
              onClick={togglePc}
              className={`ui-inset ui-focus relative h-4 w-8 ${
                pcEnabled ? 'bg-accent-solid' : 'bg-bg-tertiary'
              }`}
            >
              <span
                className="absolute top-0.5 h-2.5 w-2.5 bg-bg-elevated"
                style={{ left: pcEnabled ? '16px' : '1px' }}
              />
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'devices' ? (
        <div className="ui-card p-4 text-center">
          <Smartphone className="mx-auto h-5 w-5 text-fg-subtle" />
          <p className="mt-2 text-xs text-fg-muted">{t('settings.noDevices')}</p>
          <p className="mt-0.5 text-2xs text-fg-subtle">{t('settings.noDevicesHint')}</p>
        </div>
      ) : null}

      {tab === 'ssh' ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-fg-muted">{t('onboarding.vpsBody')}</p>
          <p className="text-2xs text-fg-muted">
            {t('settings.sshProjects')}: <span className="ui-data">{sshCount}</span>
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
            className="ui-btn ui-primary w-fit"
          >
            {t('sidebar.navVps')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
