// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import { ALL_TOOL_TOGGLE_IDS, enabledToolNames } from '@shared/tool-toggles'
import SettingsTools from '../../src/renderer/src/components/SettingsTools'
import {
  readEnabledTools,
  toggleTool,
  writeEnabledTools
} from '../../src/renderer/src/lib/tool-toggles'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('B.1 tool toggles', () => {
  it('defaults to every group enabled', () => {
    expect(readEnabledTools()).toEqual(ALL_TOOL_TOGGLE_IDS)
  })

  it('adds and removes a group id', () => {
    expect(toggleTool(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTool(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('persists the selection and disables the group tools', () => {
    writeEnabledTools(ALL_TOOL_TOGGLE_IDS.filter((id) => id !== 'migrate_database'))
    const stored = readEnabledTools()
    expect(stored).not.toContain('migrate_database')
    expect(enabledToolNames(stored)).not.toContain('migrate_database')
    expect(enabledToolNames(stored)).toContain('scaffold_project')
  })

  it('renders a checked toggle per group and stores unchecks', () => {
    render(<SettingsTools />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(ALL_TOOL_TOGGLE_IDS.length)
    expect(boxes.every((box) => box.checked)).toBe(true)

    fireEvent.click(boxes[0]!)
    expect(boxes[0]!.checked).toBe(false)
    expect(readEnabledTools()).not.toContain('migrate_database')
  })
})
