import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, HelpCircle, Send } from 'lucide-react'
import { useStore } from '../store'

/**
 * The agent's mid-run question (v2.8.0).
 *
 * Reported: "when working on a project, the assistant should ask me questions on the
 * spot like you do, and keep going — not stop completely."
 *
 * Answering here resumes the **same** run — the orchestrator is awaiting the gate, so
 * the sandbox, the context and the step budget all survive. That is the difference
 * from the previous behaviour, where the only way to ask was to end the turn and the
 * reply started a brand-new run.
 *
 * Rendered as a banner above the composer rather than a modal: it is a question, not a
 * gate, and the user may want to look at the conversation before answering.
 *
 * B2-5: when the model supplied `options`, each one is a button that answers with
 * exactly its own text. The buttons are a shortcut, not a cage — the free-text field
 * stays, and both ways call the same `submit` below, so both produce an identical
 * `respondQuestion` payload (`{ id, answer }`). Duplicating that path is how "continue
 * the same run" breaks, so there is deliberately only one.
 *
 * X2: the deadline. The run is parked on the gate in main and never moves on its own, so
 * the same configured deadline (`timeoutMs`, carried by the request from the broker's
 * `pauseAfterMs`) only changes what this card offers: the shortcut chips are replaced by
 * an explicit "resume with my best assumption" button. Nothing here settles the gate by
 * itself — a timeout is not an answer, and only a click is. The deadline is mirrored here
 * rather than kept in the store because the store's event map deliberately has no pause
 * member; the decision itself stays in `QuestionBroker`.
 */
export default function QuestionCard(): JSX.Element | null {
  const { t } = useTranslation()
  const pending = useStore((state) => state.pendingQuestion)
  const respond = useStore((state) => state.respondQuestion)
  const [answer, setAnswer] = useState('')
  const [paused, setPaused] = useState(false)
  const pendingId = pending?.id ?? null
  const deadlineMs = pending?.timeoutMs ?? 0

  useEffect(() => {
    setPaused(false)
    if (pendingId === null || !Number.isFinite(deadlineMs) || deadlineMs <= 0) return
    const timer = setTimeout(() => setPaused(true), deadlineMs)
    return () => clearTimeout(timer)
  }, [pendingId, deadlineMs])

  if (!pending) return null

  const submit = (value: string | null): void => {
    setAnswer('')
    void respond(value)
  }

  return (
    <div
      data-testid="agent-question"
      className="mx-3 mb-2 rounded-lg border border-accent/40 bg-accent-solid/10 p-3"
    >
      <p className="flex items-start gap-2 text-xs text-fg">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1" dir="auto">
          {pending.prompt}
        </span>
      </p>

      {paused ? (
        <div
          data-testid="question-paused"
          className="mt-2 flex flex-wrap items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2"
        >
          <p className="flex min-w-0 flex-1 items-start gap-1.5 text-2xs text-warning">
            <Clock className="mt-0.5 h-3 w-3 shrink-0" />
            <span dir="auto">
              {t('chat.questionPaused', {
                defaultValue:
                  'No answer yet, so the run is paused here. It will not continue on its own.'
              })}
            </span>
          </p>
          <button
            type="button"
            data-testid="question-resume"
            onClick={() => submit(null)}
            className="rounded border border-warning/50 px-2 py-1 text-2xs font-medium text-warning transition hover:bg-warning/15"
          >
            {t('chat.questionResume', { defaultValue: 'Resume with my best assumption' })}
          </button>
        </div>
      ) : null}

      {!paused && pending.options && pending.options.length > 0 ? (
        <>
          <div
            role="group"
            aria-label={t('chat.questionOptionsLabel', { defaultValue: 'Suggested answers' })}
            data-testid="question-options"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {pending.options.map((option) => (
              <button
                key={option}
                type="button"
                data-testid={'question-option-' + option}
                onClick={() => submit(option)}
                className="rounded-lg border border-border bg-bg-primary px-2 py-1 text-2xs text-fg transition hover:border-accent/50 hover:bg-bg-tertiary"
              >
                {option}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-fg-subtle">
            {t('chat.questionOptionsHint', {
              defaultValue: 'These are shortcuts — you can still type your own answer.'
            })}
          </p>
        </>
      ) : null}

      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (answer.trim() !== '') submit(answer)
        }}
      >
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={t('chat.questionPlaceholder')}
          aria-label={t('chat.questionPlaceholder')}
          data-testid="question-input"
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={answer.trim() === ''}
          data-testid="question-send"
          className="flex items-center gap-1 rounded bg-accent-solid px-2 py-1 text-2xs font-medium text-accent-fg disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {t('chat.questionSend')}
        </button>
        {paused ? null : (
          <button
            type="button"
            data-testid="question-skip"
            onClick={() => submit(null)}
            title={t('chat.questionSkipHint')}
            className="rounded px-2 py-1 text-2xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            {t('chat.questionSkip')}
          </button>
        )}
      </form>
    </div>
  )
}
