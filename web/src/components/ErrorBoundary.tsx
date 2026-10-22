import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5 text-sm text-red-200">
        <div className="font-medium">This page hit an error</div>
        <div className="mt-1 break-words font-mono text-xs text-red-300">{this.state.error.message}</div>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
        >
          Reload
        </button>
      </div>
    )
  }
}
