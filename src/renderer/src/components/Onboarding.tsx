import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, Check, FolderPlus, KeyRound, Server, Settings } from 'lucide-react'
import { ONBOARDING_STEPS, USE_CASES, recommendModel } from '@shared/onboarding'
import type { UseCase } from '@shared/onboarding'
import { useStore } from '../store'
import Modal from './ui/Modal'

/** U-17: the wizard used to be English-only; every string now has a key. */
const USE_CASE_LABELS: Record<UseCase, string> = {
  quick: 'onboarding.useCaseQuick',
  balanced: 'onboarding.useCaseBalanced',
  powerful: 'onboarding.useCasePowerful'
}

const TITLE_KEYS: Record<string, string> = {
  welcome: 'onboarding.titleWelcome',
  connect: 'onboarding.titleConnect',
  project: 'onboarding.titleProject',
  vps: 'onboarding.vpsTitle',
  done: 'onboarding.titleDone'
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
  const title = t(TITLE_KEYS[current] ?? 'onboarding.titleWelcome')
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
    // U-17: the shared Modal primitive — the hand-rolled overlay sat at z-40,
    // far below the real modal layer (z-[9999]), and had no focus trap.
    <Modal
      open
      maxWidth="min(34rem, 92vw)"
      maxHeight="calc(100vh - 2rem)"
      ariaLabel={title}
    >
      {/* The panel's own column: a fixed header, the scrolling body and a fixed
          footer, so the wizard's actions stay reachable for any content. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
          <Sparkle current={current} />
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          <span className="ml-auto text-3xs text-neutral-500">
            {t('onboarding.stepOf', { current: step + 1, total: ONBOARDING_STEPS.length })}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-sm text-neutral-300">
          {current === 'welcome' ? (
            <div className="flex flex-col gap-4">
              <p>{t('onboarding.welcomeBody')}</p>
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
                    {t(USE_CASE_LABELS[option])}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                {t('onboarding.suggestedModel', {
                  model: recommendModel(useCase).model,
                  reason: recommendModel(useCase).reason
                })}
              </p>
            </div>
          ) : null}

          {current === 'connect' ? (
            <div className="flex flex-col gap-3">
              <StatusRow
                ok={hasKey}
                label={hasKey ? t('onboarding.keySaved') : t('onboarding.noKey')}
              />
              <p className="text-xs text-neutral-500">{t('onboarding.connectBody')}</p>
              <button
                type="button"
                onClick={openSettings}
                className="flex w-fit items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-neutral-200 hover:bg-bg-tertiary"
              >
                <Settings className="h-3.5 w-3.5" />
                {t('onboarding.openSettings')}
              </button>
            </div>
          ) : null}

          {current === 'project' ? (
            <div className="flex flex-col gap-3">
              <StatusRow
                ok={hasProject}
                label={hasProject ? t('onboarding.projectReady') : t('onboarding.noProject')}
              />
              <p className="text-xs text-neutral-500">{t('onboarding.projectBody')}</p>
              <button
                type="button"
                onClick={openSettings}
                className="flex w-fit items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-neutral-200 hover:bg-bg-tertiary"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('onboarding.addProject')}
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
              <StatusRow ok label={t('onboarding.setupComplete')} />
              <p className="text-xs text-neutral-500">{t('onboarding.doneBody')}</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
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
    </Modal>
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
