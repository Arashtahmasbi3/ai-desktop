/**
 * One empty/error block for the whole app (U3-6).
 *
 * The audit found nine surfaces answering "there is nothing here" in nine different shapes —
 * some with no way forward at all, one with five buttons, several with an error that only said
 * "something went wrong". The rule is now a component, so it cannot drift per panel:
 *
 *  - `title` says **what is missing** (empty) or **what failed** (error) — never both at once and
 *    never a shrug;
 *  - `body` says why, and what the way forward is;
 *  - at most **two** actions: the primary way forward and, only when it genuinely helps, one
 *    alternative. Both are real navigations or real calls — a control that cannot work belongs in
 *    `body` as an explanation, not on screen as a button (see AGENTS.md, "No interface for a
 *    capability that does not exist");
 *  - an error keeps its technical detail behind a disclosure, so the headline stays readable and
 *    the raw IPC message is still reachable when it is needed.
 *
 * Presentational on purpose: the caller owns the handlers and the translations, so this file
 * never invents copy and never reaches for the store.
 */
import type { ReactNode } from 'react'

/** One way forward. `onClick` must do something real; `label` must be visible text. */
export interface EmptyStateAction {
  label: string
  onClick: () => void
  testId?: string
}

export interface EmptyStateProps {
  /** What is missing, or what failed. The first line the user reads. */
  title: string
  /** Why it is missing and what to do about it. */
  body?: string
  /** The primary way forward. */
  primary?: EmptyStateAction
  /** One alternative, and only when it genuinely helps. */
  secondary?: EmptyStateAction
  /** An error carries the danger edge; the geometry is identical so the app reads as one system. */
  tone?: 'empty' | 'error'
  /** Technical detail (an IPC message, the first stack line) — disclosed, never in the headline. */
  detail?: { label: string; text: string }
  /** Optional leading mark for the surfaces that have one (a panel icon, a stamped plate). */
  mark?: ReactNode
  testId?: string
  className?: string
}

export const EMPTY_STATE_TEST_ID = 'empty-state'

export default function EmptyState({
  title,
  body,
  primary,
  secondary,
  tone = 'empty',
  detail,
  mark,
  testId,
  className
}: EmptyStateProps): JSX.Element {
  /*
   * Filtering rather than trusting the props is deliberate: "at most two" is the rule, and the
   * two named slots are the only way to supply one, so a third action cannot be bolted on later
   * without changing this interface.
   */
  const actions: EmptyStateAction[] = [primary, secondary].filter(
    (action): action is EmptyStateAction => Boolean(action)
  )

  return (
    <section
      data-testid={testId ?? EMPTY_STATE_TEST_ID}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : undefined}
      className={`brutal-card flex flex-col items-start gap-2 p-4 text-start${
        tone === 'error' ? ' border-danger' : ''
      }${className ? ` ${className}` : ''}`}
    >
      {mark ? <div aria-hidden="true">{mark}</div> : null}
      <p className="brutal-label text-fg">{title}</p>
      {body ? <p className="max-w-prose text-xs leading-relaxed text-fg-muted">{body}</p> : null}
      {actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-testid={action.testId}
              onClick={action.onClick}
              /*
               * A toast-triggering action is never "primary" and a navigation is never "danger":
               * the filled surface is reserved for the one thing that moves the user forward.
               */
              className={action === primary ? 'brutal-btn brutal-primary' : 'brutal-btn'}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {detail ? (
        <details className="mt-1 w-full">
          <summary className="brutal-label cursor-pointer text-fg-subtle">{detail.label}</summary>
          <pre
            dir="ltr"
            className="brutal-inset mt-1 max-h-32 overflow-auto whitespace-pre-wrap px-2 py-1 text-3xs text-fg-muted"
          >
            {detail.text}
          </pre>
        </details>
      ) : null}
    </section>
  )
}
