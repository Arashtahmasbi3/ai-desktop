import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import type {
  HostApprovalRequirement,
  HostPolicy,
  HostPolicyMode,
  VpsServerView
} from '@shared/vps'
import { defaultHostPolicy, DEFAULT_READ_ONLY_COMMANDS, DEFAULT_WRITE_COMMANDS } from '@core/remote/host-policy'
import { useStore } from '../../store'

const MODES: HostPolicyMode[] = ['read-only', 'staging', 'production']
const APPROVALS: HostApprovalRequirement[] = ['never', 'destructive', 'always']

const MODE_KEY: Record<HostPolicyMode, string> = {
  'read-only': 'settings.hostPolicyReadOnly',
  staging: 'settings.hostPolicyStaging',
  production: 'settings.hostPolicyProduction'
}
const APPROVAL_KEY: Record<HostApprovalRequirement, string> = {
  never: 'settings.hostPolicyApprovalNever',
  destructive: 'settings.hostPolicyApprovalDestructive',
  always: 'settings.hostPolicyApprovalAlways'
}

const field = 'w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-neutral-100 outline-none focus:border-accent'

function list(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Per-host command policy editor (v2.3.1, B.3). */
export default function HostPolicyEditor({ server }: { server: VpsServerView }): JSX.Element {
  const { t } = useTranslation()
  const refreshVps = useStore((state) => state.refreshVps)
  const pushToast = useStore((state) => state.pushToast)
  const current = server.policy ?? defaultHostPolicy(server.id, 'staging')

  const [mode, setMode] = useState<HostPolicyMode>(current.mode)
  const [approval, setApproval] = useState<HostApprovalRequirement>(current.requireApproval)
  const [allow, setAllow] = useState(current.allowCommands.join(', '))
  const [deny, setDeny] = useState(current.denyCommands.join(', '))
  const [paths, setPaths] = useState(current.allowedPaths.join(', '))
  const [readOnly, setReadOnlyCommands] = useState(
    current.readOnlyCommands ?? DEFAULT_READ_ONLY_COMMANDS
  )
  const [writeCmds, setWriteCommands] = useState(current.writeCommands ?? DEFAULT_WRITE_COMMANDS)
  const [busy, setBusy] = useState(false)

  const changeMode = (next: HostPolicyMode): void => {
    const defaults = defaultHostPolicy(server.id, next)
    setMode(next)
    setApproval(defaults.requireApproval)
    setAllow(defaults.allowCommands.join(', '))
    setDeny(defaults.denyCommands.join(', '))
    setReadOnlyCommands(defaults.readOnlyCommands ?? DEFAULT_READ_ONLY_COMMANDS)
    setWriteCommands(defaults.writeCommands ?? DEFAULT_WRITE_COMMANDS)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const policy: HostPolicy = {
        vpsId: server.id,
        mode,
        requireApproval: approval,
        allowCommands: list(allow),
        denyCommands: list(deny),
        allowedPaths: list(paths),
        readOnlyCommands: readOnly,
        writeCommands: writeCmds
      }
      await window.api.vps.save({
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType,
        policy
      })
      await refreshVps()
      pushToast('success', t('settings.hostPolicySaved'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-200">
        <ShieldCheck className="h-3 w-3" />
        {server.name}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-neutral-500">
          {t('settings.hostPolicyMode')}
          <select value={mode} onChange={(event) => changeMode(event.target.value as HostPolicyMode)} className={field}>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {t(MODE_KEY[value])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-neutral-500">
          {t('settings.hostPolicyApproval')}
          <select
            value={approval}
            onChange={(event) => setApproval(event.target.value as HostApprovalRequirement)}
            className={field}
          >
            {APPROVALS.map((value) => (
              <option key={value} value={value}>
                {t(APPROVAL_KEY[value])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input value={allow} onChange={(event) => setAllow(event.target.value)} placeholder={t('settings.hostPolicyAllow')} className={field} />
      <input value={deny} onChange={(event) => setDeny(event.target.value)} placeholder={t('settings.hostPolicyDeny')} className={field} />
      <input value={paths} onChange={(event) => setPaths(event.target.value)} placeholder={t('settings.hostPolicyPaths')} className={field} />
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="w-fit rounded bg-accent px-2.5 py-1 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {t('settings.hostPolicySave')}
      </button>
    </div>
  )
}
