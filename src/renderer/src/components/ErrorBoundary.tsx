import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  error: Error | null
}

/**
 * U-16: show the reason, never a stack trace. An IPC or library failure can put
 * a whole stack into `error.message`; only the first line is shown, capped.
 */
function safeMessage(error: Error): string {
  const first = String(error?.message ?? error).split('\n')[0].trim()
  return first.length > 300 ? `${first.slice(0, 300)}…` : first
}

/** Keeps one panel's render error from blanking the whole window. */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label ?? 'panel'}] render error`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-warning" />
        <div>
          <p className="text-sm text-fg">
            {this.props.label ?? 'This panel'} crashed while rendering.
          </p>
          <p className="mt-1 max-w-md font-mono text-2xs text-fg-muted">
            {safeMessage(error)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1 rounded bg-accent-solid px-3 py-1 text-xs text-white hover:bg-accent-solid-hover"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    )
  }
}
