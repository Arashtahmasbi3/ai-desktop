import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, Check, FolderPlus, KeyRound, Server, Settings } from 'lucide-react'
import { ONBOARDING_STEPS, USE_CASES, recommendModel } from '@shared/onboarding'
import type { UseCase } from '@shared/onboarding'
import { useStore } from '../store'

const USE_CASE_LABELS: Record<UseCase, string> = {
  quick: 'Quick & cheap',
  balanced: 'Balanced',
  powerful: 'Most capable'
}

/**
 * First-run wizard: welcome + model suggestion, API key pointer, first project,
 * then a summary. Rendered before SettingsPanel so Settings can appear on top.
 */
export default function Onboarding(): JSX.Element | null {
  const { t } = useTranslation()
  const ready = useStore((state) => state.ready)
  const onboarding = useStore((state) => state.onboarding)
  const settings = useStore((state) => state.settings)
  const openSettings = useStore((state) => state.openSettings)
  const completeOnboarding = useStore((state) => state.completeOnboarding)
  const setSelection = useStore((state) => state.setSelection)
  const setView = useStore((state) => state.setView)

  const [step, setStep] = useState(0)
  const [useCase, setUseCase] = useState<UseCase>('quick')

  if (!ready || !onboarding || onboarding.completed) return null

  const current = ONBOARDING_STEPS[step]
  const hasKey = Object.values(settings?.providers ?? {}).some((provider) => provider?.hasApiKey)
  const hasProject = (settings?.projects?.length ?? 0) > 0
  const last = step === ONBOARDING_STEPS.length - 1

  const finish = async (): Promise<void> => {
    const recommendation = recommendModel(useCase)
    setSelection({
      provider: recommendation.provider,
      model: recommendation.model,
      customProviderId: undefined
    })
    if (!last) {
      setStep((value) => value + 1)
      return
    }
    await completeOnboarding()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="flex w-[min(34rem,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Sparkle current={current} />
          <h2 className="text-sm font-semibold text-neutral-100">
            {current === 'welcome'
              ? 'Welcome to AI Desktop'
              : current === 'connect'
                ? 'Connect a provider'
                : current === 'project'
                  ? 'Add your first project'
                  : current === 'vps'
                    ? t('onboarding.vpsTitle')
                    : 'You are all set'}
          </h2>
          <span className="ml-auto text-[10px] text-neutral-500">
            {t('onboarding.stepOf', { current: step + 1, total: ONBOARDING_STEPS.length })}
          </span>
        </div>

        <div className="px-5 py-5 text-sm text-neutral-300">
          {current === 'welcome' ? (
            <div className="flex flex-col gap-4">
              <p>
                AI Desktop connects an AI assistant to your local files, GitHub and VPS. Pick what
                you will mostly use it for — we will pre-select a model for you.
              </p>
              <div className="flex flex-wrap gap-2">
                {USE_CASES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setUseCase(option)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      useCase === option
                        ? 'border-accent bg-accent/20 text-accent'
                        : 'border-border text-neutral-400 hover:bg-bg-tertiary'
                    }`}
                  >
                    {USE_CASE_LABELS[option]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Suggested model: <span className="font-mono">{recommendModel(useCase).model}</span>{' '}
                — {recommendModel(useCase).reason}
              </p>
            </div>
          ) : null}

          {current === 'connect' ? (
            <div className="flex flex-col gap-3">
              <StatusRow ok={hasKey} label={hasKey ? 'A provider key is saved' : 'No provider key yet'} />
              <p className="text-xs text-neutral-500">
                Add a DeepSeek, OpenAI, Anthropic or Gemini key in Settings. You can also add any
                OpenAI-compatible endpoint under “Custom providers”.
              </p>
              <button
                type="button"
                onClick={openSettings}
                className="flex w-fit items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-neutral-200 hover:bg-bg-tertiary"
              >
                <Settings className="h-3.5 w-3.5" />
                Open Settings
              </button>
            </div>
          ) : null}

          {current === 'project' ? (
            <div className="flex flex-col gap-3">
              <StatusRow
                ok={hasProject}
                label={hasProject ? 'A project is available' : 'No project yet'}
              />
              <p className="text-xs text-neutral-500">
                Projects point the assistant at a folder on your machine. Add one in Settings, or
                drag a folder onto the window later.
              </p>
              <button
                type="button"
                onClick={openSettings}
                className="flex w-fit items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-neutral-200 hover:bg-bg-tertiary"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Add a project
              </button>
            </div>
          ) : null}

          {current === 'vps' ? (
            <div className="flex flex-col gap-3">
              <StatusRow ok label={t('onboarding.vpsTitle')} />
              <p className="text-xs text-neutral-500">{t('onboarding.vpsBody')}</p>
              <button
                type="button"
                onClick={() => {
                  setView('vps')
                  void completeOnboarding()
                }}
                className="flex w-fit items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-neutral-200 hover:bg-bg-tertiary"
              >
                <Server className="h-3.5 w-3.5" />
                {t('sidebar.navVps')}
              </button>
            </div>
          ) : null}

          {current === 'done' ? (
            <div className="flex flex-col gap-3">
              <StatusRow ok label="Setup complete" />
              <p className="text-xs text-neutral-500">
                Use the model picker in the chat header to switch models any time. Press Ctrl+, to
                reopen Settings.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0}
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-30"
          >
            {t('onboarding.back')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void completeOnboarding()}
              className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300"
            >
              {t('onboarding.skip')}
            </button>
            <button
              type="button"
              onClick={() => void finish()}
              className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
            >
              {last ? t('onboarding.getStarted') : t('onboarding.next')}
              {last ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Sparkle({ current }: { current: string }): JSX.Element {
  if (current === 'connect') return <KeyRound className="h-4 w-4 text-accent" />
  if (current === 'project') return <FolderPlus className="h-4 w-4 text-accent" />
  if (current === 'vps') return <Server className="h-4 w-4 text-accent" />
  if (current === 'done') return <Check className="h-4 w-4 text-emerald-400" />
  return <Bot className="h-4 w-4 text-accent" />
}

function StatusRow({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-bg-tertiary text-neutral-500'
        }`}
      >
        {ok ? <Check className="h-3 w-3" /> : '?'}
      </span>
      <span className={ok ? 'text-neutral-200' : 'text-neutral-500'}>{label}</span>
    </div>
  )
}
