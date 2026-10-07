import { describe, it, expect } from 'vitest'
import {
  OPCODE,
  computeAccept,
  decodeFrames,
  encodeFrame,
  upgradeResponse
} from '@core/remote/ws-frame'

/** Build a masked client->server frame (as browsers do). */
function maskedFrame(payload: string, opcode = OPCODE.text): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const header = Buffer.from([0x80 | opcode, 0x80 | data.length])
  const masked = Buffer.from(data)
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
  return Buffer.concat([header, mask, masked])
}

describe('computeAccept', () => {
  it('matches the RFC 6455 example', () => {
    expect(computeAccept('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })
})

describe('encodeFrame / decodeFrames', () => {
  it('round-trips a short text frame', () => {
    const { frames, rest } = decodeFrames(encodeFrame('hello'))
    expect(rest).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].opcode).toBe(OPCODE.text)
    expect(frames[0].payload.toString('utf8')).toBe('hello')
  })

  it('round-trips a medium frame (16-bit length)', () => {
    const text = 'x'.repeat(1000)
    const { frames } = decodeFrames(encodeFrame(text))
    expect(frames[0].payload.toString('utf8')).toBe(text)
  })

  it('decodes masked client frames', () => {
    const { frames } = decodeFrames(maskedFrame('{"method":"status"}'))
    expect(frames[0].payload.toString('utf8')).toBe('{"method":"status"}')
  })

  it('returns the unconsumed remainder for partial frames', () => {
    const full = encodeFrame('partial')
    const first = decodeFrames(full.subarray(0, 3))
    expect(first.frames).toHaveLength(0)
    expect(first.rest.length).toBe(3)

    const rest = full.subarray(3)
    const second = decodeFrames(Buffer.concat([first.rest, rest]))
    expect(second.frames[0].payload.toString('utf8')).toBe('partial')
  })

  it('decodes multiple frames from one buffer', () => {
    const buffer = Buffer.concat([encodeFrame('a'), encodeFrame('b'), encodeFrame('c')])
    const { frames } = decodeFrames(buffer)
    expect(frames.map((frame) => frame.payload.toString())).toEqual(['a', 'b', 'c'])
  })
})

describe('upgradeResponse', () => {
  it('builds a 101 response containing the accept key', () => {
    const response = upgradeResponse({ 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' })
    expect(response).toContain('101 Switching Protocols')
    expect(response).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })

  it('returns null without a key', () => {
    expect(upgradeResponse({})).toBeNull()
  })
})
