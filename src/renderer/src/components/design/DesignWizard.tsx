import { useMemo, useState } from 'react'
import {
  BRAND_OPTIONS,
  NEED_OPTIONS,
  SITE_TYPE_OPTIONS,
  WIZARD_STEPS,
  type DesignAnswers,
  type DesignKind,
  type DesignLocale,
  type DesignSiteType
} from '@shared/design'
import { useStore } from '../../store'
import i18n from '../../i18n'

/**
 * The five-question wizard (phase 0).
 *
 * One question per screen, a sensible default on every step, and nothing technical anywhere in the copy: the user of
 * this product may never have built a website. The last step only asks for a name; the pages and modules are generated
 * by `suggestDesign` so the user never lands on an empty board.
 */
export default function DesignWizard({
  onCancel,
  onDone
}: {
  onCancel: () => void
  onDone: () => void
}): React.JSX.Element {
  const createDesign = useStore((state) => state.createDesign)
  const busy = useStore((state) => state.designBusy)

  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<DesignKind>('website')
  const [type, setType] = useState<DesignSiteType>('corporate')
  const [needs, setNeeds] = useState<string[]>(['contact'])
  const [brand, setBrand] = useState('blue')
  const [locale, setLocale] = useState<DesignLocale>('fa')
  const [name, setName] = useState('')

  const answers: DesignAnswers = useMemo(
    () => ({ kind, type, needs, brand, locale, siteName: name.trim() }),
    [kind, type, needs, brand, locale, name]
  )

  const toggleNeed = (id: string): void =>
    setNeeds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )

  const canContinue = step < 4 || name.trim().length > 0

  const finish = async (): Promise<void> => {
    const created = await createDesign(answers)
    if (created) onDone()
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6" data-testid="design-wizard">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-3xs text-fg-muted">
            {i18n.t('design.wizardStep', { current: step + 1, total: WIZARD_STEPS.length })}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-fg-strong">
            {WIZARD_STEPS[step]?.question}
          </h2>
          <p className="mt-1 text-xs text-fg-muted">{WIZARD_STEPS[step]?.hint}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary"
        >
          {i18n.t('design.cancel')}
        </button>
      </header>

      <section className="min-h-[12rem]">
        {step === 0 ? (
          <div className="grid grid-cols-2 gap-2" data-testid="design-step-kind">
            {(
              [
                { id: 'website' as const, label: i18n.t('design.kindWebsite') },
                { id: 'app' as const, label: i18n.t('design.kindApp') }
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={kind === option.id}
                onClick={() => setKind(option.id)}
                className={`rounded border px-4 py-6 text-sm ${
                  kind === option.id
                    ? 'border-accent bg-accent-solid/10 text-fg-strong'
                    : 'border-border text-fg hover:bg-bg-tertiary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid grid-cols-2 gap-2" data-testid="design-step-type">
            {SITE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={type === option.id}
                onClick={() => setType(option.id)}
                className={`rounded border px-4 py-3 text-sm ${
                  type === option.id
                    ? 'border-accent bg-accent-solid/10 text-fg-strong'
                    : 'border-border text-fg hover:bg-bg-tertiary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <ul className="flex flex-col gap-2" data-testid="design-step-needs">
            {NEED_OPTIONS.map((option) => (
              <li key={option.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded border border-border px-3 py-2 hover:bg-bg-tertiary">
                  <input
                    type="checkbox"
                    checked={needs.includes(option.id)}
                    onChange={() => toggleNeed(option.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-fg">{option.label}</span>
                    <span className="block text-3xs text-fg-muted">{option.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4" data-testid="design-step-look">
            <div className="flex gap-2">
              {BRAND_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={brand === option.id}
                  onClick={() => setBrand(option.id)}
                  className={`h-10 w-10 rounded border ${
                    brand === option.id ? 'border-fg-strong' : 'border-border'
                  }`}
                  style={{ backgroundColor: option.color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {(
                [
                  { id: 'fa' as const, label: 'فارسی' },
                  { id: 'en' as const, label: 'English' }
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={locale === option.id}
                  onClick={() => setLocale(option.id)}
                  className={`rounded border px-4 py-2 text-sm ${
                    locale === option.id
                      ? 'border-accent bg-accent-solid/10 text-fg-strong'
                      : 'border-border text-fg hover:bg-bg-tertiary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-2" data-testid="design-step-name">
            <label className="text-xs text-fg-muted" htmlFor="design-site-name">
              {i18n.t('design.siteNameLabel')}
            </label>
            <input
              id="design-site-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={i18n.t('design.siteNamePlaceholder')}
              className="rounded border border-border bg-bg-primary px-3 py-2 text-sm text-fg"
            />
          </div>
        ) : null}
      </section>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 0 || busy}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="rounded border border-border px-4 py-2 text-xs text-fg disabled:opacity-40"
        >
          {i18n.t('design.back')}
        </button>
        {step < 4 ? (
          <button
            type="button"
            disabled={!canContinue || busy}
            onClick={() => setStep((current) => Math.min(4, current + 1))}
            className="rounded bg-accent-solid px-5 py-2 text-sm text-white disabled:opacity-40"
          >
            {i18n.t('design.next')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canContinue || busy}
            onClick={() => void finish()}
            data-testid="design-finish"
            className="rounded bg-accent-solid px-5 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy ? i18n.t('design.building') : i18n.t('design.buildAndShow')}
          </button>
        )}
      </footer>
    </div>
  )
}
