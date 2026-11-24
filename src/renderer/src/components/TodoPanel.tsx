import { useEffect } from 'react'
import { useStore } from '../store'
import i18n from '../i18n'
import type { TodoStatus } from '@shared/todo'

/**
 * The checklist panel (T04).
 *
 * What the assistant says it is working on, in the order it wrote it. No editing here on purpose: the list belongs to
 * the run, and a user who wants something added says it in the chat, where the agent can also explain why.
 */
export default function TodoPanel(): React.JSX.Element {
  const todos = useStore((state) => state.todos)
  const presented = useStore((state) => state.presented)
  const refresh = useStore((state) => state.refreshTodos)
  const refreshPresented = useStore((state) => state.refreshPresented)

  useEffect(() => {
    void refresh()
    void refreshPresented()
  }, [refresh, refreshPresented])

  const label = (status: TodoStatus): string =>
    status === 'completed'
      ? i18n.t('todos.completed')
      : status === 'in_progress'
        ? i18n.t('todos.inProgress')
        : i18n.t('todos.pending')

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6" data-testid="todo-panel">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-fg-strong">{i18n.t('todos.title')}</h2>
          <p className="mt-1 text-xs text-fg-muted">{i18n.t('todos.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary"
        >
          {i18n.t('todos.refresh')}
        </button>
      </header>

      {todos.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
          {i18n.t('todos.empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="todo-list">
          {todos.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2"
              data-status={item.status}
            >
              <span
                className={`text-xs ${
                  item.status === 'completed' ? 'text-fg-muted line-through' : 'text-fg'
                }`}
              >
                {item.text}
              </span>
              <span
                className={`shrink-0 text-3xs ${
                  item.status === 'completed'
                    ? 'text-success'
                    : item.status === 'in_progress'
                      ? 'text-warning'
                      : 'text-fg-muted'
                }`}
              >
                {label(item.status)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* T11: what the agent presented as the result of the run. */}
      <section className="mt-2">
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">{i18n.t('todos.deliverables')}</h3>
        {presented.length === 0 ? (
          <p className="rounded border border-dashed border-border px-4 py-4 text-center text-xs text-fg-muted">
            {i18n.t('todos.noDeliverables')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="presented-list">
            {presented.map((item) => (
              <li
                key={item.path}
                className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg" dir="ltr">
                    {item.path}
                  </p>
                  {item.description ? (
                    <p className="text-3xs text-fg-muted">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void window.api.fs.reveal(item.path)}
                  className="shrink-0 rounded border border-border px-2 py-0.5 text-3xs text-fg hover:bg-bg-tertiary"
                >
                  {i18n.t('todos.reveal')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
