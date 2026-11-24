/**
 * A dependency-free ZIP writer, shared by the design build and the Office builders.
 *
 * Adding `archiver` for a few kilobytes of text would put a new runtime dependency into an app whose packaging rule is
 * "Vite bundles everything, only `ssh2` ships". Stored (uncompressed) entries are enough for OOXML text parts, are
 * reproducible byte-for-byte, and need no zlib.
 *
 * Deterministic on purpose: timestamp 0 and fixed ordering, so the same input produces the same archive.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface Entry {
  name: string
  data: Buffer
  crc: number
  offset: number
}

export function zipStore(files: Record<string, string | Buffer>): Buffer {
  const entries: Entry[] = []
  const locals: Buffer[] = []
  let offset = 0

  for (const name of Object.keys(files).sort()) {
    const data = Buffer.isBuffer(files[name]) ? files[name]! : Buffer.from(files[name]!, 'utf8')
    const crc = crc32(data)
    const nameBytes = Buffer.from(name, 'utf8')

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // 1980-01-01, fixed
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)

    entries.push({ name, data, crc, offset })
    locals.push(local, data)
    offset += local.length + data.length
  }

  const centrals: Buffer[] = []
  let centralSize = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(entry.crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(entry.offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    centralSize += central.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, ...centrals, end])
}
