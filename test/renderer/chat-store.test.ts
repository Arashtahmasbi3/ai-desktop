import { describe, it, expect } from 'vitest'
import { CHAT_GROUPS, groupChats, groupFor, titleFromMessages } from '../../src/shared/chat'
import { detectLocale } from '../../src/renderer/src/i18n/locale'

const DAY = 24 * 60 * 60 * 1000

// A fixed local noon so the "yesterday"/"week" boundaries are deterministic.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime()

describe('chat grouping', () => {
  it('buckets chats into today / yesterday / this week / older', () => {
    expect(groupFor(NOW - 60_000, NOW)).toBe('today')
    expect(groupFor(NOW - DAY, NOW)).toBe('yesterday')
    expect(groupFor(NOW - 3 * DAY, NOW)).toBe('thisWeek')
    expect(groupFor(NOW - 30 * DAY, NOW)).toBe('older')
  })

  it('groups chats and keeps newest first within each group', () => {
    const chats = [
      { id: 'old', updatedAt: NOW - 30 * DAY },
      { id: 'yesterday', updatedAt: NOW - DAY },
      { id: 'newer', updatedAt: NOW - 1000 },
      { id: 'older-today', updatedAt: NOW - 3600_000 },
      { id: 'week', updatedAt: NOW - 3 * DAY }
    ]
    const groups = groupChats(chats, NOW)
    expect(Object.keys(groups)).toEqual(CHAT_GROUPS)
    expect(groups.today.map((chat) => chat.id)).toEqual(['newer', 'older-today'])
    expect(groups.yesterday.map((chat) => chat.id)).toEqual(['yesterday'])
    expect(groups.thisWeek.map((chat) => chat.id)).toEqual(['week'])
    expect(groups.older.map((chat) => chat.id)).toEqual(['old'])
  })

  it('derives a title from the first user message', () => {
    expect(
      titleFromMessages([
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: '  Fix   the build  ' }
      ])
    ).toBe('Fix the build')
    expect(titleFromMessages([])).toBe('Untitled')
    expect(
      titleFromMessages([{ role: 'user', content: 'x'.repeat(80) }])
    ).toHaveLength(49)
  })
})

describe('locale detection', () => {
  it('detects Farsi and defaults everything else to English', () => {
    expect(detectLocale('fa')).toBe('fa')
    expect(detectLocale('fa-IR')).toBe('fa')
    expect(detectLocale('en-US')).toBe('en')
    expect(detectLocale('de')).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
  })
})
