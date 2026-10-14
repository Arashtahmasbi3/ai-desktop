// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import LoopStopCard from '../../src/renderer/src/components/LoopStopCard'
import { buildLoopStopModel } from '../../src/renderer/src/lib/loop-stop'
import type { LoopStopInfo } from '../../src/shared/agent'

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
    expect(screen.getByText('srv-9')).toBeDefined()
    expect(screen.getByText('VPS')).toBeDefined()
    expect(screen.getByText(/Several steps failed/)).toBeDefined()
    const continueButton = screen.getByText('Continue').closest('button') as HTMLButtonElement
    // v2.8.0: it was disabled here, which left the user with no way forward.
    expect(continueButton.disabled).toBe(false)
  })
})
