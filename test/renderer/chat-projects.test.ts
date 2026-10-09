import { describe, it, expect } from 'vitest'
import { groupChatsByProject } from '../../src/shared/chat'

const chat = (id: string, workspaceId: string | undefined, updatedAt: number) => ({
  id,
  workspaceId,
  updatedAt
})

describe('groupChatsByProject', () => {
  it('buckets chats under their project, newest first', () => {
    const groups = groupChatsByProject(
      [chat('a', 'p1', 1), chat('b', 'p1', 3), chat('c', 'p2', 2)],
      ['p1', 'p2']
    )
    expect(groups.map((group) => group.projectId)).toEqual(['p1', 'p2'])
    expect(groups[0].chats.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(groups[1].chats.map((entry) => entry.id)).toEqual(['c'])
  })

  it('puts chats with no project (or a deleted project) in a trailing bucket', () => {
    const groups = groupChatsByProject(
      [chat('legacy', undefined, 5), chat('orphan', 'gone', 6), chat('x', 'p1', 1)],
      ['p1']
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].projectId).toBe('p1')
    expect(groups[1].projectId).toBeUndefined()
    expect(groups[1].chats.map((entry) => entry.id)).toEqual(['orphan', 'legacy'])
  })

  it('omits empty project groups and returns an empty list for no chats', () => {
    expect(groupChatsByProject([], ['p1', 'p2'])).toEqual([])
    const groups = groupChatsByProject([chat('a', undefined, 1)], ['p1'])
    expect(groups.map((group) => group.projectId)).toEqual([undefined])
  })
})
