import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, HelpCircle, Send } from 'lucide-react'
import { useStore } from '../store'
import { CHAT_MAX_WIDTH } from '../lib/layout'

/**
 * The agent's mid-run question (v2.8.0; a bottom sheet in v4.3).
 *
 * Reported: "when working on a project, the assistant should ask me questions on the
 * spot like you do, and keep going — not stop completely."
 *
 * Answering here resumes the **same** run — the orchestrator is awaiting the gate, so
 * the sandbox, the context and the step budget all survive. That is the difference
 * from the previous behaviour, where the only way to ask was to end the turn and the
 * reply started a brand-new run.
 *
 * v4.3 turned it into a bottom sheet, for the reason the report gave: the old card grew
 * three rows (question, a wrapping block of sentence-length options, a hint, an input row)
 * and could push the transcript around while the agent was still working. A sheet is a
 * fixed-height surface with one question and one decision in it:
 *
 *   the question, at most **four** single-line chips (each ellipsised), one input, and
 *   exactly two buttons — Answer and Skip.
 *
 * B2-5: a chip answers with exactly its own text. The chips are a shortcut, not a cage —
 * the free-text field stays, and both ways call the same `submit` below, so both produce an
 * identical `respondQuestion` payload (`{ id, answer }`). Duplicating that path is how
 * "continue the same run" breaks, so there is deliberately only one.
 *
 * X2: the deadline. The run is parked on the gate in main and never moves on its own, so
 * the same configured deadline (`timeoutMs`, carried by the request from the broker's
 * `pauseAfterMs`) only changes what this sheet offers: the chips are replaced by an
 * explicit "resume with my best assumption" button. Nothing here settles the gate by
 * itself — a timeout is not an answer, and only a click is.
 */

/** A sheet with more than four chips is a list of paragraphs again — the E3 complaint. */
const MAX_CHIPS = 4

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

  const chips = (pending.options ?? []).slice(0, MAX_CHIPS)

  return (
    <div
      data-testid="agent-question"
      role="region"
      aria-label={t('questionSheet.title', { defaultValue: 'The agent has a question' })}
      dir="auto"
      className="fixed inset-x-0 bottom-0 z-overlay border-t border-accent bg-bg-elevated"
    >
      <div
        className="mx-auto flex w-full flex-col gap-2 px-4 py-2"
        style={{ maxWidth: CHAT_MAX_WIDTH }}
      >
        <p className="flex items-start gap-2 text-xs text-fg-strong">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1" dir="auto">
            {pending.prompt}
          </span>
        </p>

        {paused ? (
          <div
            data-testid="question-paused"
            className="ui-row gap-2 rounded-shape-sm border border-warning/50 px-2 text-2xs text-warning"
          >
            <Clock className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {t('chat.questionPaused', {
                defaultValue:
                  'No answer yet, so the run is paused here. It will not continue on its own.'
              })}
            </span>
            <button
              type="button"
              data-testid="question-resume"
              onClick={() => submit(null)}
              className="shrink-0 rounded-shape-sm border border-warning/50 px-2 py-0.5 text-2xs font-medium text-warning hover:bg-warning/10"
            >
              {t('chat.questionResume', { defaultValue: 'Resume with my best assumption' })}
            </button>
          </div>
        ) : chips.length > 0 ? (
          <div
            role="group"
            aria-label={t('chat.questionOptionsLabel', { defaultValue: 'Suggested answers' })}
            data-testid="question-options"
            className="flex min-w-0 items-center gap-1.5 overflow-hidden"
          >
            {chips.map((option) => (
              <button
                key={option}
                type="button"
                data-testid={'question-option-' + option}
                onClick={() => submit(option)}
                title={option}
                className="max-w-[16rem] shrink-0 truncate whitespace-nowrap rounded-shape-pill border border-border px-2 py-0.5 text-2xs text-fg hover:border-accent hover:bg-bg-tertiary"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="flex items-center gap-1.5"
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
            className="ui-inset h-7 min-w-0 flex-1 px-2 text-xs text-fg-strong outline-none placeholder:text-fg-subtle focus:border-accent"
          />
          <button
            type="submit"
            disabled={answer.trim() === ''}
            data-testid="question-send"
            className="ui-primary flex h-7 shrink-0 items-center gap-1 px-2.5 text-2xs font-medium disabled:opacity-50"
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
              className="flex h-7 shrink-0 items-center rounded-shape-sm px-2 text-2xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              {t('questionSheet.skip', { defaultValue: 'Skip' })}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
