import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  error: Error | null
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
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <div>
          <p className="text-sm text-neutral-200">
            {this.props.label ?? 'This panel'} crashed while rendering.
          </p>
          <p className="mt-1 max-w-md font-mono text-2xs text-neutral-500">{error.message}</p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    )
  }
}
