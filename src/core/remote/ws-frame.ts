import { createHash } from 'node:crypto'

/** RFC 6455 handshake GUID. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa
} as const

export function computeAccept(key: string): string {
  return createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64')
}

export interface DecodedFrame {
  opcode: number
  fin: boolean
  payload: Buffer
}

/**
 * Encode a single server->client WebSocket frame (unmasked). Supports payloads
 * up to 2^53 bytes via the 64-bit length form.
 */
export function encodeFrame(data: Buffer | string, opcode: number = OPCODE.text): Buffer {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const length = payload.length
  let header: Buffer

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

/**
 * Decode as many complete frames as `buffer` contains. Returns the frames and
 * the unconsumed remainder (for streamed input). Client frames must be masked.
 */
export function decodeFrames(buffer: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = []
  let offset = 0

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let headerLength = 2

    if (length === 126) {
      if (offset + 4 > buffer.length) break
      length = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(offset + 2))
      headerLength = 10
    }

    let maskKey: Buffer | null = null
    if (masked) {
      if (offset + headerLength + 4 > buffer.length) break
      maskKey = buffer.subarray(offset + headerLength, offset + headerLength + 4)
      headerLength += 4
    }

    const start = offset + headerLength
    const end = start + length
    if (end > buffer.length) break

    const payload = Buffer.from(buffer.subarray(start, end))
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]
    }
    frames.push({ opcode, fin, payload })
    offset = end
  }

  return { frames, rest: buffer.subarray(offset) }
}

export interface HandshakeHeaders {
  [key: string]: string | string[] | undefined
}

/** Build the 101 response for a WebSocket upgrade, or null if the key is missing. */
export function upgradeResponse(headers: HandshakeHeaders): string | null {
  const key = headers['sec-websocket-key']
  if (typeof key !== 'string') return null
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${computeAccept(key)}`,
    '',
    ''
  ].join('\r\n')
}
