// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import LoopStopCard from '../../src/renderer/src/components/LoopStopCard'
import { buildLoopStopModel } from '../../src/renderer/src/lib/loop-stop'
import { useStore } from '../../src/renderer/src/store'
import type { LoopStopInfo } from '../../src/shared/agent'
import type { VpsServerView } from '../../src/shared/vps'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const server = (id: string, name: string): VpsServerView =>
  ({
    id,
    name,
    host: `${name}.example.com`,
    port: 22,
    username: 'root',
    authType: 'password',
    hasPassword: true,
    hasPrivateKey: false,
    createdAt: 1,
    updatedAt: 1
  }) as VpsServerView

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

function stop(overrides: Partial<LoopStopInfo> = {}): LoopStopInfo {
  return { reason: 'repeated_action', message: 'Stuck', recentActions: [], ...overrides }
}

const noop = (): void => undefined

describe('P5 buildLoopStopModel', () => {
  it('1. picks a hint and emphasis per reason', () => {
    expect(buildLoopStopModel(stop({ reason: 'repeated_action' }))).toMatchObject({
      hintKey: 'chat.loopStopHintRepeated',
      emphasis: 'correct'
    })
    expect(buildLoopStopModel(stop({ reason: 'turn_timeout' }))).toMatchObject({
      hintKey: 'chat.loopStopHintTimeout',
      emphasis: 'continue'
    })
  })

  it('2. offers Continue for every stop reason, including a failure streak', () => {
    // v2.8.0: `failure_streak` was the one reason whose primary action was disabled
    // — and it was also the most common stop, so the card offered nothing the user
    // could click. Continue starts a fresh run carrying the conversation's context.
    expect(buildLoopStopModel(stop({ reason: 'failure_streak' })).allowContinue).toBe(true)
    expect(buildLoopStopModel(stop({ reason: 'no_progress' })).allowContinue).toBe(true)
    expect(buildLoopStopModel(stop({ reason: 'repeated_action' })).allowContinue).toBe(true)
    expect(buildLoopStopModel(stop({ reason: 'turn_timeout' })).allowContinue).toBe(true)
  })

  it('3. extracts the stuck command and VPS host from the last action', () => {
    const model = buildLoopStopModel(
      stop({ recentActions: ['remote_shell(server_id=srv-9, command=systemctl status app)'] })
    )
    expect(model.onRemote).toBe(true)
    expect(model.serverId).toBe('srv-9')
    expect(model.lastCommand).toBe('systemctl status app')
  })
})

describe('P5 LoopStopCard context', () => {
  it('4. shows the tailored hint and highlights the recommended action', () => {
    render(
      <LoopStopCard stop={stop({ reason: 'repeated_action' })} onContinue={noop} onCorrect={noop} onStop={noop} />
    )
    expect(screen.getByText(/kept running the same action/)).toBeDefined()
    expect(screen.getByText('Correct').closest('button')?.className).toContain('ring-2')
    expect(screen.getByText('Continue').closest('button')?.className).not.toContain('ring-2')
  })

  it('5. surfaces the stuck VPS command and keeps Continue usable after failures', () => {
    // R6: the card names the machine instead of printing its id.
    useStore.setState({ vpsServers: [server('srv-9', 'spmotor')] })
    render(
      <LoopStopCard
        stop={stop({
          reason: 'failure_streak',
          recentActions: ['remote_shell(server_id=srv-9, command=systemctl status app)']
        })}
        onContinue={noop}
        onCorrect={noop}
        onStop={noop}
      />
    )
    expect(screen.getByText('systemctl status app')).toBeDefined()
    expect(screen.getByText('spmotor')).toBeDefined()
    // The id is not rendered anywhere in the card; the name above is what the reader gets.
    expect(screen.getByTestId('loop-stop-card').textContent ?? '').not.toContain('srv-9')
    expect(screen.getByText('VPS')).toBeDefined()
    expect(screen.getByText(/Several steps failed/)).toBeDefined()
    const continueButton = screen.getByText('Continue').closest('button') as HTMLButtonElement
    // v2.8.0: it was disabled here, which left the user with no way forward.
    expect(continueButton.disabled).toBe(false)
  })

  /*
   * R6a: the reported stop card printed
   *   `get_system_health: Diagnostics always run against the server selected in the chat
   *    header (34c80099-…), not e000539d-….`
   * A UUID is not a name. This case pins the renderer half: the chip carries the server's name
   * and the action line drops its `server_id=` field, so no UUID reaches the visible card.
   */
  it('6. never renders a raw server UUID (R6)', () => {
    const pinned = '34c80099-2868-40a1-bef4-9b23d865db0b'
    useStore.setState({ vpsServers: [server(pinned, 'spmotor')] })
    render(
      <LoopStopCard
        stop={stop({
          reason: 'failure_streak',
          recentActions: [`get_system_health(server_id=${pinned})`],
          recentFailures: [
            { name: 'get_system_health', error: 'Server spmotor is not connected.' }
          ]
        })}
        onContinue={noop}
        onCorrect={noop}
        onStop={noop}
      />
    )

    const card = screen.getByTestId('loop-stop-card')
    expect(card.textContent).toContain('spmotor')
    expect(card.textContent ?? '').not.toMatch(UUID_RE)
    // The tooltip is part of what the user sees when they hover, so it is checked too.
    for (const element of [card, ...Array.from(card.querySelectorAll('[title]'))]) {
      expect(element.getAttribute('title') ?? '').not.toMatch(UUID_RE)
    }
  })
})
