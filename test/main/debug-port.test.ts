import { describe, expect, it } from 'vitest'
import {
  DEBUG_PORT_ENV,
  DEBUG_PORT_MAX,
  DEBUG_PORT_MIN,
  debugPortActiveNotice,
  debugPortRefusalNotice,
  debugPortTargetUrl,
  isLoopbackAddress,
  parseDebugPort,
  resolveDebugPort
} from '@main/debug-port'

/**
 * O4-2. The debug port is the one switch that can hand a renderer to any local
 * process, so each way of getting this wrong gets its own case: a stray empty
 * value, a boolean-looking value, a privileged port, a conflicting source and a
 * routable bind address. The tests inject argv/env; nothing here reads the real
 * process.
 */
describe('resolveDebugPort — OFF unless an explicit port is given', () => {
  it('is off with a packaged argv that carries no switch', () => {
    const decision = resolveDebugPort({
      argv: ['C:\\Program Files\\AI Desktop\\AI Desktop.exe'],
      env: {}
    })
    expect(decision).toEqual({ enabled: false, reason: 'not-requested', detail: '' })
  })

  it('is off in dev shape (exe, app dir) with no switch', () => {
    expect(
      resolveDebugPort({ argv: ['electron.exe', '.', '--no-sandbox'], env: {} })
    ).toMatchObject({ enabled: false, reason: 'not-requested' })
  })

  it('is off when the environment variable is absent from a populated env', () => {
    expect(
      resolveDebugPort({ argv: [], env: { PATH: 'C:\\Windows', HOME: 'C:\\Users\\x' } })
    ).toMatchObject({ enabled: false, reason: 'not-requested' })
  })

  it('ignores unrelated switches that merely contain the word port', () => {
    expect(
      resolveDebugPort({ argv: ['--remoteDebuggingPort=9223', '--port=1'], env: {} })
    ).toMatchObject({ enabled: false, reason: 'not-requested' })
  })
})

describe('resolveDebugPort — the flag form survives a packaged launch', () => {
  it('reads --remote-debugging-port=<n> after the packaged exe path', () => {
    expect(
      resolveDebugPort({
        argv: ['C:\\Users\\me\\AppData\\Local\\Programs\\AI Desktop\\AI Desktop.exe', '--remote-debugging-port=9222'],
        env: {}
      })
    ).toEqual({ enabled: true, port: 9222, source: 'argv' })
  })

  it('reads the dev argv shape produced by electron-vite', () => {
    expect(
      resolveDebugPort({ argv: ['electron.exe', '.', '--remote-debugging-port=9223'], env: {} })
    ).toEqual({ enabled: true, port: 9223, source: 'argv' })
  })

  it('accepts the space-separated form as well as =', () => {
    expect(resolveDebugPort({ argv: ['app.exe', '--remote-debugging-port', '9300'], env: {} })).toEqual({
      enabled: true,
      port: 9300,
      source: 'argv'
    })
  })

  it('accepts the lowest and highest allowed ports', () => {
    for (const port of [DEBUG_PORT_MIN, DEBUG_PORT_MAX]) {
      expect(
        resolveDebugPort({ argv: [`--remote-debugging-port=${port}`], env: {} })
      ).toMatchObject({ enabled: true, port })
    }
  })

  it('deduplicates the same port given twice', () => {
    expect(
      resolveDebugPort({ argv: ['--remote-debugging-port=9222', '--remote-debugging-port=9222'], env: {} })
    ).toMatchObject({ enabled: true, port: 9222 })
  })
})

describe('resolveDebugPort — the environment variable', () => {
  it('opens the port in a packaged build with no argv switch at all', () => {
    expect(
      resolveDebugPort({
        argv: ['C:\\Program Files\\AI Desktop\\AI Desktop.exe'],
        env: { [DEBUG_PORT_ENV]: '9222' }
      })
    ).toEqual({ enabled: true, port: 9222, source: 'env' })
  })

  it('trims surrounding whitespace', () => {
    expect(
      resolveDebugPort({ argv: [], env: { [DEBUG_PORT_ENV]: ' 9222 ' } })
    ).toMatchObject({ enabled: true, port: 9222, source: 'env' })
  })

  it('agrees with an identical flag and reports the flag as the source', () => {
    expect(
      resolveDebugPort({ argv: ['--remote-debugging-port=9222'], env: { [DEBUG_PORT_ENV]: '9222' } })
    ).toEqual({ enabled: true, port: 9222, source: 'argv' })
  })
})

describe('resolveDebugPort — values that must NOT enable anything', () => {
  const invalidPorts = ['0', '1', '80', '1023', '65536', '99999', '-1', '9222.0', '9222x', '0x2406', '', '  ', 'true', 'yes', 'on']

  it.each(invalidPorts)('refuses the port value %j', (value) => {
    const decision = resolveDebugPort({ argv: [`--remote-debugging-port=${value}`], env: {} })
    expect(decision.enabled).toBe(false)
    expect(decision).toMatchObject({ reason: 'invalid-port' })
  })

  it.each(['', 'true', 'yes', '1', '9222x'])('refuses the environment value %j', (value) => {
    const decision = resolveDebugPort({ argv: [], env: { [DEBUG_PORT_ENV]: value } })
    expect(decision.enabled).toBe(false)
    expect(decision).toMatchObject({ reason: 'invalid-port' })
  })

  it('refuses a bare flag with no value instead of choosing a default port', () => {
    const decision = resolveDebugPort({ argv: ['AI Desktop.exe', '--remote-debugging-port'], env: {} })
    expect(decision).toMatchObject({ enabled: false, reason: 'invalid-port' })
    if (decision.enabled) throw new Error('unreachable')
    expect(decision.detail).toContain('no default')
  })

  it('refuses the flag when the flag and the environment disagree', () => {
    const decision = resolveDebugPort({
      argv: ['--remote-debugging-port=9222'],
      env: { [DEBUG_PORT_ENV]: '9333' }
    })
    expect(decision).toMatchObject({ enabled: false, reason: 'conflicting-port' })
    if (decision.enabled) throw new Error('unreachable')
    expect(decision.detail).toContain('9222 and 9333')
  })

  it('refuses a value that is only valid as an environment name', () => {
    expect(
      resolveDebugPort({ argv: ['--remote-debugging-port=AI_DESKTOP_DEBUG_PORT'], env: {} })
    ).toMatchObject({ enabled: false, reason: 'invalid-port' })
  })
})

describe('resolveDebugPort — loopback only', () => {
  it('accepts the loopback spellings Chromium understands', () => {
    for (const address of ['127.0.0.1', 'localhost', '::1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackAddress(address)).toBe(true)
    }
  })

  it('refuses to bind a routable address, and says which one', () => {
    const decision = resolveDebugPort({
      argv: ['--remote-debugging-port=9222', '--remote-debugging-address=0.0.0.0'],
      env: {}
    })
    expect(decision).toMatchObject({ enabled: false, reason: 'non-loopback-address' })
    if (decision.enabled) throw new Error('unreachable')
    expect(decision.detail).toContain('0.0.0.0')
  })

  it('refuses a LAN or IPv6-any bind', () => {
    for (const address of ['192.168.1.10', '::', '10.0.0.5']) {
      expect(
        resolveDebugPort({ argv: ['--remote-debugging-port=9222', `--remote-debugging-address=${address}`], env: {} })
      ).toMatchObject({ enabled: false, reason: 'non-loopback-address' })
    }
  })

  it('still enables the port when the address is loopback', () => {
    expect(
      resolveDebugPort({
        argv: ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'],
        env: {}
      })
    ).toMatchObject({ enabled: true, port: 9222 })
  })

  it('refuses an address switch with no value', () => {
    expect(
      resolveDebugPort({ argv: ['--remote-debugging-port=9222', '--remote-debugging-address'], env: {} })
    ).toMatchObject({ enabled: false, reason: 'non-loopback-address' })
  })

  it('does not enable anything when only an address was given', () => {
    const decision = resolveDebugPort({ argv: ['--remote-debugging-address=127.0.0.1'], env: {} })
    expect(decision).toMatchObject({ enabled: false, reason: 'invalid-port' })
  })
})

describe('parseDebugPort', () => {
  it('accepts plain integers in range and rejects everything else', () => {
    expect(parseDebugPort('9222')).toBe(9222)
    expect(parseDebugPort(' 9222 ')).toBe(9222)
    expect(parseDebugPort('09222')).toBe(9222)
    for (const value of ['', '0', '1023', '65536', '9222.5', '  ', '9222a']) {
      expect(parseDebugPort(value)).toBeNull()
    }
  })
})

describe('notices', () => {
  it('targets loopback and states the port', () => {
    expect(debugPortTargetUrl(9222)).toBe('http://127.0.0.1:9222/json')
  })

  it('warns in words about exposure and how to turn it off', () => {
    const notice = debugPortActiveNotice(9222, 'env')
    expect(notice).toContain('WARNING')
    expect(notice).toContain('http://127.0.0.1:9222/json')
    expect(notice).toContain('no authentication')
    expect(notice).toContain(DEBUG_PORT_ENV)
    expect(notice).toContain('127.0.0.1 only')
    expect(debugPortActiveNotice(9222, 'argv')).toContain('--remote-debugging-port')
  })

  it('keeps a refusal visible instead of failing silently', () => {
    const notice = debugPortRefusalNotice({
      enabled: false,
      reason: 'invalid-port',
      detail: 'value "true" is not a port.'
    })
    expect(notice).toContain('NOT enabled')
    expect(notice).toContain('value "true" is not a port.')
    expect(debugPortRefusalNotice({ enabled: false, reason: 'not-requested', detail: '' })).toBe('')
  })
})
