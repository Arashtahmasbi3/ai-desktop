// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import { decideSend } from '../../src/renderer/src/lib/context-gate'
import ContextPreviewCard from '../../src/renderer/src/components/ContextPreviewCard'
import {
  useStore,
  readShowContextBeforeSend,
  CONTEXT_SETTINGS_KEY
} from '../../src/renderer/src/store'
import type { ContextPreview } from '../../src/shared/context-preview'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  // v2.8.0: the preview is off unless the user asks for it, so the store default
  // is now false and each scenario opts in explicitly.
  useStore.setState({ showContextBeforeSend: readShowContextBeforeSend() })
})

afterEach(cleanup)

const preview: ContextPreview = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  tokens: 120,
  included: [{ key: 'system', label: 'System prompt', tokens: 80 }],
  blockedFiles: [],
  excluded: ['Secrets and API keys']
}

/**
 * Task 1.1 - context preview toggle. The toggle shipped earlier; these four
 * scenarios are the missing coverage. They exercise the real submit decision
 * (`decideSend`), the real dialog component, the live store setter and the
 * persistence read used on restart.
 */
describe('Task 1.1 - show context preview before send', () => {
  it('1. showContextBeforeSend=true → the send is gated behind the preview', () => {
    const decision = decideSend('hello', [], true)
    expect(decision).toEqual({ body: 'hello', preview: true })

    render(<ContextPreviewCard preview={preview} onSend={() => undefined} onClose={() => undefined} />)
    expect(screen.getByText('Context to be sent')).toBeTruthy()
    expect(screen.getByText('deepseek · deepseek-chat')).toBeTruthy()
  })

  it('2. showContextBeforeSend=false → no preview, straight to send', () => {
    const decision = decideSend('hello', [], false)
    expect(decision).toEqual({ body: 'hello', preview: false })
    expect(decideSend('   ', [], true)).toBeNull()
  })

  it('3. changing it in Settings applies immediately to the store', () => {
    // Off out of the box: sending a message must not open a cost dialog.
    expect(useStore.getState().showContextBeforeSend).toBe(false)
    useStore.getState().setShowContextBeforeSend(true)
    expect(useStore.getState().showContextBeforeSend).toBe(true)
    useStore.getState().setShowContextBeforeSend(false)
    expect(useStore.getState().showContextBeforeSend).toBe(false)
  })

  it('4. the choice survives a restart (persisted then re-read)', () => {
    useStore.getState().setShowContextBeforeSend(true)
    expect(localStorage.getItem(CONTEXT_SETTINGS_KEY)).toBe('1')
    // A fresh app start reads the same key back from localStorage.
    expect(readShowContextBeforeSend()).toBe(true)

    useStore.getState().setShowContextBeforeSend(false)
    expect(localStorage.getItem(CONTEXT_SETTINGS_KEY)).toBe('0')
    expect(readShowContextBeforeSend()).toBe(false)
  })

  it('5. nothing stored means no preview (the pre-v2.8 behaviour was the opposite)', () => {
    expect(localStorage.getItem(CONTEXT_SETTINGS_KEY)).toBeNull()
    expect(readShowContextBeforeSend()).toBe(false)
    expect(decideSend('hello', [], readShowContextBeforeSend())).toEqual({
      body: 'hello',
      preview: false
    })
  })
})
