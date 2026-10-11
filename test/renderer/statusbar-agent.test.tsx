// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import { useStore } from '../../src/renderer/src/store'
import type { WorkerStatus } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function worker(online: boolean): WorkerStatus {
  return {
    state: online ? 'idle' : 'stopped',
    active: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    maxConcurrent: 2,
    memoryMb: 8192,
    cpuCores: 8,
    online,
    remoteEnabled: false,
    jobs: []
  }
}

beforeEach(() => {
  useStore.setState({
    ready: true,
    worker: worker(true),
    remote: null,
    vpsServerId: undefined,
    vpsStatus: { status: 'disconnected' }
  })
})

/** Task 1.3 - clearer remote/agent status in the status bar. */
describe('Task 1.3 - StatusBar agent status', () => {
  it('1. worker.online → "Agent: running" with the worker address tooltip', () => {
    useStore.setState({
      worker: worker(true),
      remote: { enabled: true, host: '127.0.0.1', port: 4321, clients: 0 }
    })
    render(<StatusBar />)
    const status = screen.getByText(/Agent: running/)
    expect(status).toBeTruthy()
    expect(status.getAttribute('title')).toContain('Agent running')
    expect(status.getAttribute('title')).toContain('127.0.0.1:4321')
    // The remote toggle is kept alongside the new agent indicator.
    expect(screen.getByText(/remote:/)).toBeTruthy()
  })

  it('2. worker offline → "Agent: not running" with a warning tooltip', () => {
    useStore.setState({ worker: worker(false) })
    render(<StatusBar />)
    const status = screen.getByText(/Agent: not running/)
    expect(status).toBeTruthy()
    expect(status.getAttribute('title')).toContain('offline')
    expect(status.className).toContain('text-red-400')
  })
})
