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
  const refresh = useStore((state) => state.refreshTodos)

  useEffect(() => {
    void refresh()
  }, [refresh])

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
    </div>
  )
}
