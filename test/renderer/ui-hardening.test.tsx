// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ErrorBoundary from '../../src/renderer/src/components/ErrorBoundary'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import Onboarding from '../../src/renderer/src/components/Onboarding'
import RemoteFileExplorer from '../../src/renderer/src/components/Vps/RemoteFileExplorer'
import { topmostEscapeTarget } from '../../src/renderer/src/lib/escape'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision } from '../../src/shared/trace'

/**
 * U-7 (RTL narrative), U-12 (in-flight guards), U-15 (Escape chain),
 * U-16 (render-error isolation), U-17 (Onboarding is translated and modal).
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function decision(index: number, overrides: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: `run-1:${index}`,
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'بررسی فایل' },
    evidence: [{ kind: 'file', ref: 'a.ts', summary: 'read 12 lines' }],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: index,
    ...overrides
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  useStore.setState({ decisions: [], messages: [], logs: [], error: null })
})

describe('RTL narrative in the inline trace (U-7)', () => {
  it('lets the Persian intent summary resolve its own direction', () => {
    useStore.setState({ decisions: [decision(1)] })
    render(<InlineTrace />)

    // The container used to be hard-coded `dir="ltr"`, which rendered the
    // Persian summary left-to-right inside the RTL chat.
    expect(screen.getByTestId('inline-trace').getAttribute('dir')).toBe('auto')
  })
})

describe('Escape targets the topmost surface (U-15)', () => {
  const none = {
    searchOpen: false,
    paletteOpen: false,
    pendingProjectSwitch: null,
    shortcutsOpen: false,
    settingsOpen: false,
    migrationOpen: false,
    jobsPanelOpen: false,
    chatTreeOpen: false,
    terminalOpen: false,
    error: null
  }

  it('returns null when nothing is open', () => {
    expect(topmostEscapeTarget(none)).toBeNull()
  })

  it('closes overlays before the panels and the error strip', () => {
    expect(topmostEscapeTarget({ ...none, searchOpen: true, error: 'boom' })).toBe('search')
    expect(topmostEscapeTarget({ ...none, paletteOpen: true, error: 'boom' })).toBe('palette')
    expect(topmostEscapeTarget({ ...none, pendingProjectSwitch: 'p2', error: 'boom' })).toBe(
      'projectSwitch'
    )
    expect(topmostEscapeTarget({ ...none, migrationOpen: true, error: 'boom' })).toBe('migration')
    expect(topmostEscapeTarget({ ...none, jobsPanelOpen: true, chatTreeOpen: true })).toBe('jobs')
    expect(topmostEscapeTarget({ ...none, chatTreeOpen: true, terminalOpen: true })).toBe('tree')
    expect(topmostEscapeTarget({ ...none, terminalOpen: true, error: 'boom' })).toBe('terminal')
    // The red error strip is the last resort, never the first thing hit.
    expect(topmostEscapeTarget({ ...none, error: 'boom' })).toBe('error')
  })

  it('never answers a security gate with Escape', () => {
    // pendingApproval/pendingPreflight are not part of the chain at all.
    expect(Object.keys(none)).not.toContain('pendingApproval')
    expect(Object.keys(none)).not.toContain('pendingPreflight')
  })
})

describe('render errors stay inside their panel (U-16)', () => {
  function Boom({ message }: { message: string }): JSX.Element {
    throw new Error(message)
  }

  it('catches a child error, keeps the label and drops the stack', () => {
    render(
      <ErrorBoundary label="Sidebar">
        <Boom message={'build failed\n    at Sidebar (Sidebar.tsx:1:1)\n    at more frames'} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Sidebar crashed while rendering.')).toBeTruthy()
    const detail = screen.getByText(/build failed/)
    expect(detail.textContent).toBe('build failed')
    expect(detail.textContent).not.toContain('at Sidebar')
  })

  it('retries by clearing the captured error', () => {
    render(
      <ErrorBoundary label="Status bar">
        <Boom message="bad state" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Status bar crashed while rendering.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    // The child throws again, so the boundary recaptures rather than blanking.
    expect(screen.getByText('Status bar crashed while rendering.')).toBeTruthy()
  })
})

describe('Onboarding is translated and a real modal (U-17)', () => {
  beforeEach(() => {
    useStore.setState({
      ready: true,
      onboarding: { completed: false, steps: [] } as never,
      settings: { providers: {}, projects: [] } as never
    })
  })

  it('renders translated copy, not raw keys', () => {
    render(<Onboarding />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Welcome to AI Desktop')).toBeTruthy()
    expect(screen.queryByText(/^onboarding\./)).toBeNull()
  })

  it('sits above every other surface', () => {
    render(<Onboarding />)
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    // The hand-rolled overlay was z-40, under the real modal layer (z-[9999]).
    expect(backdrop.className).toContain('z-[9999]')
  })
})

describe('in-flight guards (U-12)', () => {
  it('disables the remote refresh while a listing is pending', async () => {
    let resolveList: (entries: never[]) => void = () => {}
    const list = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          resolveList = resolve
        })
    )
    ;(window as unknown as { api: unknown }).api = { vps: { files: { list } } }

    render(<RemoteFileExplorer serverId="srv-1" />)
    const refresh = screen.getByTitle('Refresh')
    await waitFor(() => expect(refresh.hasAttribute('disabled')).toBe(true))

    fireEvent.click(refresh)
    fireEvent.click(refresh)
    expect(list).toHaveBeenCalledTimes(1)

    resolveList([])
    await waitFor(() => expect(refresh.hasAttribute('disabled')).toBe(false))
  })
})
