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

describe('StatusBar agent status — unknown is not "running"', () => {
  it('says so when no worker status has been reported yet', () => {
    // v2.7.0: `worker: null` used to default to online, so the bar claimed
    // "Agent: running" beside "worker: idle" before anything had reported in.
    useStore.setState({ worker: null })
    render(<StatusBar />)

    const status = screen.getByText(/Agent: —/)
    expect(status).toBeTruthy()
    expect(status.getAttribute('title')).toContain('No agent status')
    expect(screen.queryByText(/Agent: running/)).toBeNull()
  })
})

/** Task 1.3 - clearer remote/agent status in the status bar. */
describe('Task 1.3 - StatusBar agent status', () => {
  it('1. worker.online → "Agent: ready" with the worker address tooltip', () => {
    useStore.setState({
      worker: worker(true),
      remote: { enabled: true, host: '127.0.0.1', port: 4321, clients: 0 }
    })
    render(<StatusBar />)
    // v2.7.0: "Agent: running" sat beside "worker: idle" and read as a
    // contradiction; the service being up is "ready", the worker state says
    // whether anything is actually running.
    const status = screen.getByText(/Agent: ready/)
    expect(status).toBeTruthy()
    expect(status.getAttribute('title')).toContain('Agent service is up')
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
    // v2.7.0: the status colour is the semantic `danger` token.
    expect(status.className).toContain('text-danger')
  })
})
