import { ipcMain } from 'electron'
import type { TodoList } from '@shared/todo'
import type { TodoStore } from './todo-store'

/**
 * IPC for the working checklist (T04). One read channel: the panel asks when it opens, and the next open sees the list
 * the model wrote. There is no push event yet, and the matrix says so rather than pretending the panel is live.
 */
export function registerTodoIpc(store: TodoStore): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['todos:list', (): Promise<TodoList> => store.read()]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
