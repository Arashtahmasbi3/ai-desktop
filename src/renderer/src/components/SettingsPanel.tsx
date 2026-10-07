import { useState } from 'react'
import {
  Check,
  FolderPlus,
  KeyRound,
  Trash2,
  X
} from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { ProviderId } from '@shared/types'
import { useStore } from '../store'

export default function SettingsPanel(): JSX.Element | null {
  const open = useStore((state) => state.settingsOpen)
  const settings = useStore((state) => state.settings)
  const close = useStore((state) => state.closeSettings)
  const setApiKey = useStore((state) => state.setApiKey)
  const removeApiKey = useStore((state) => state.removeApiKey)
  const setModel = useStore((state) => state.setModel)
  const setActiveProvider = useStore((state) => state.setActiveProvider)
  const addProject = useStore((state) => state.addProject)
  const removeProject = useStore((state) => state.removeProject)
  const openProject = useStore((state) => state.openProject)

  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [savingKey, setSavingKey] = useState<ProviderId | null>(null)

  if (!open) return null

  const projects = settings?.projects ?? []

  const saveKey = async (provider: ProviderId): Promise<void> => {
    const value = keys[provider]?.trim()
    if (!value) return
    setSavingKey(provider)
    await setApiKey(provider, value)
    setSavingKey(null)
    setKeys((current) => ({ ...current, [provider]: '' }))
  }

  const browse = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) setProjectPath(picked)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="flex max-h-[85vh] w-[min(52rem,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-neutral-100">Settings</h2>
          <button
            type="button"
            onClick={close}
            title="Close (Esc)"
            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <KeyRound className="h-3.5 w-3.5" />
              Providers &amp; API keys
            </h3>
            <div className="flex flex-col gap-3">
              {PROVIDER_IDS.map((provider) => {
                const descriptor = PROVIDERS[provider]
                const view = settings?.providers?.[provider]
                const active = settings?.activeProvider === provider
                const model = view?.model ?? descriptor.defaultModel
                return (
                  <div key={provider} className="rounded-xl border border-border bg-bg-primary p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                        {descriptor.label}
                        {view?.hasApiKey ? (
                          <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            <Check className="h-3 w-3" />
                            key saved
                          </span>
                        ) : (
                          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-neutral-500">
                            no key
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void setActiveProvider(provider)}
                        disabled={active}
                        className={`rounded px-2 py-0.5 text-[11px] ${
                          active
                            ? 'bg-accent/20 text-accent'
                            : 'border border-border text-neutral-400 hover:bg-bg-tertiary'
                        }`}
                      >
                        {active ? 'active' : 'set active'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={keys[provider] ?? ''}
                        onChange={(event) =>
                          setKeys((current) => ({ ...current, [provider]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveKey(provider)
                        }}
                        placeholder="API key (stored encrypted)"
                        dir="ltr"
                        autoComplete="off"
                        className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
                      />
                      <button
                        type="button"
                        onClick={() => void saveKey(provider)}
                        disabled={!keys[provider]?.trim() || savingKey === provider}
                        className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                      >
                        Save
                      </button>
                      {view?.hasApiKey ? (
                        <button
                          type="button"
                          onClick={() => void removeApiKey(provider)}
                          title="Remove key"
                          className="rounded border border-border p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-[11px] text-neutral-500">Model</label>
                      <select
                        value={model}
                        onChange={(event) => void setModel(provider, event.target.value)}
                        className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                      >
                        {descriptor.models.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <FolderPlus className="h-3.5 w-3.5" />
              Projects
            </h3>

            <div className="mb-3 flex items-center gap-2">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Name"
                className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
              />
              <input
                value={projectPath}
                onChange={(event) => setProjectPath(event.target.value)}
                placeholder="Path (e.g. C:\\Users\\me\\project)"
                dir="ltr"
                className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void browse()}
                className="rounded border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary"
              >
                Browse
              </button>
              <button
                type="button"
                disabled={!projectPath.trim()}
                onClick={() => {
                  void addProject(projectName.trim(), projectPath.trim())
                  setProjectName('')
                  setProjectPath('')
                }}
                className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Add
              </button>
            </div>

            {projects.length === 0 ? (
              <p className="text-xs text-neutral-600">No projects yet.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between border-b border-border bg-bg-primary px-3 py-2 text-xs last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => void openProject(project.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="text-neutral-200">{project.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-neutral-500" dir="ltr">
                        {project.path}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeProject(project.id)}
                      className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
