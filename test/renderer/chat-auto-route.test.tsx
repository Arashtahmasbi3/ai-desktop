// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ModelSwitcher from '../../src/renderer/src/components/ModelSwitcher'
import { useStore } from '../../src/renderer/src/store'

/**
 * T20 (per-chat) — the auto-model toggle in the header.
 *
 * The switch is per conversation and defaults to off, and toggling it must flip the store value the next run reads. It is
 * deliberately next to the model picker: turning it on means "ignore my picked model for this message".
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({
    chatAutoRoute: false,
    running: false,
    selection: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    customProviders: []
  } as never)
  cleanup()
})

describe('chat auto-route toggle (T20)', () => {
  it('starts off and flips on when clicked', () => {
    render(<ModelSwitcher />)
    const toggle = screen.getByTestId('chat-auto-route')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    expect(useStore.getState().chatAutoRoute).toBe(true)
  })

  it('flips back off', () => {
    useStore.setState({ chatAutoRoute: true } as never)
    render(<ModelSwitcher />)

    fireEvent.click(screen.getByTestId('chat-auto-route'))

    expect(useStore.getState().chatAutoRoute).toBe(false)
  })
})
