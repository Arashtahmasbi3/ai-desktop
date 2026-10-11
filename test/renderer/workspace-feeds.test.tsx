// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import OutputFeed from '../../src/renderer/src/components/OutputFeed'
import SourcesList from '../../src/renderer/src/components/SourcesList'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import { DEFAULT_SELECTION } from '@shared/selection'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ messages: [], running: false, selection: DEFAULT_SELECTION, settings: null })
})

afterEach(cleanup)

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role: 'tool', content: '', at: 1, ...overrides }
}

/**
 * v2.6.0, B.4 - Output and Sources are separate views inside the workspace
 * column, so tool output is never confused with what was fed to the model.
 */
describe('v2.6.0 B.4 - Output / Sources split', () => {
  it('1. OutputFeed shows an empty state before any tool runs', () => {
    render(<OutputFeed />)
    expect(screen.getByText('No tool output yet.')).toBeTruthy()
  })

  it('2. OutputFeed lists tool calls with their command and exit code', () => {
    useStore.setState({
      messages: [
        message({
          toolCall: {
            name: 'remote_shell',
            ok: false,
            command: 'pm2 logs api',
            stdout: '',
            stderr: 'not found',
            exitCode: 1
          }
        })
      ]
    })
    render(<OutputFeed />)
    expect(screen.getByText('pm2 logs api')).toBeTruthy()
    expect(screen.getByText('exit 1')).toBeTruthy()
    // Failed calls open by default so the error is visible.
    expect(screen.getByText('not found')).toBeTruthy()
  })

  it('3. OutputFeed shows a running indicator while the agent is busy', () => {
    useStore.setState({ running: true })
    render(<OutputFeed />)
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('4. SourcesList separates files read from the context that is sent', () => {
    useStore.setState({
      messages: [
        message({ toolCall: { name: 'read_file', ok: true, path: 'src/index.ts' } }),
        message({ toolCall: { name: 'remote_read_file', ok: true, path: 'server/app.py' } })
      ]
    })
    render(<SourcesList />)

    expect(screen.getByText('Files read')).toBeTruthy()
    expect(screen.getByText('src/index.ts')).toBeTruthy()
    expect(screen.getByText('server/app.py')).toBeTruthy()
    expect(screen.getByText('Context sent')).toBeTruthy()
  })

  it('5. SourcesList is empty until a file is read', () => {
    render(<SourcesList />)
    expect(screen.getByText('No sources yet.')).toBeTruthy()
  })
})
