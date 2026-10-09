import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Laptop, Server, Smartphone, Terminal } from 'lucide-react'
import { readPrefs, writePrefs } from '../lib/prefs'
import { useStore } from '../store'
import HostPolicyEditor from './Vps/HostPolicyEditor'

type ConnectionTab = 'pc' | 'devices' | 'ssh'

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
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
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
                  ? 'bg-accent/15 text-accent'
                  : 'text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200'
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
            <p className="flex items-center gap-2 text-sm text-neutral-200">
              <span
                className={`h-1.5 w-1.5 rounded-full ${pcEnabled ? 'bg-emerald-400' : 'bg-neutral-600'}`}
              />
              {t('settings.thisPc')}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
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
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-neutral-300 hover:bg-bg-tertiary"
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
                pcEnabled ? 'bg-accent' : 'bg-bg-tertiary'
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
          <Smartphone className="mx-auto h-5 w-5 text-neutral-600" />
          <p className="mt-2 text-xs text-neutral-400">{t('settings.noDevices')}</p>
          <p className="mt-0.5 text-[11px] text-neutral-600">{t('settings.noDevicesHint')}</p>
        </div>
      ) : null}

      {tab === 'ssh' ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-neutral-400">{t('onboarding.vpsBody')}</p>
          <p className="text-[11px] text-neutral-500">
            {t('settings.sshProjects')}: {sshCount}
          </p>
          <div className="flex flex-col gap-2">
            {vpsServers.length === 0 ? (
              <p className="text-[11px] text-neutral-600">{t('settings.hostPolicyNone')}</p>
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
            className="w-fit rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
          >
            {t('sidebar.navVps')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
