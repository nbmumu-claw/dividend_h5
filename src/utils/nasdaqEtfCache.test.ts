import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isChinaTradingSession, readNasdaqEtfCache, writeNasdaqEtfCache } from './nasdaqEtfCache'

const body = ['513110', '159513', '159632', '159660', '513390', '513870',
  '513300', '159659', '159941', '159696', '513100', '159501'].map(code => {
  const fields = Array(79).fill('')
  fields[3] = '2.453'
  fields[30] = '20261113145959'
  fields[32] = '0.50'
  fields[57] = '10000'
  fields[72] = '100000000'
  fields[78] = '2.1234'
  return `v_${code.startsWith('5') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`
}).join('\n')
const at = (value: string) => Date.parse(`${value}+08:00`)
let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
})

describe('Nasdaq ETF browser snapshot', () => {
  it('keeps Friday closing quotes through the weekend and expires at Monday opening', () => {
    writeNasdaqEtfCache(body, at('2026-11-13T15:01:00'))
    expect(readNasdaqEtfCache(at('2026-11-15T10:00:00'))).toBe(body)
    expect(readNasdaqEtfCache(at('2026-11-16T09:15:00'))).toBeNull()
  })

  it('does not store incomplete quotes', () => {
    writeNasdaqEtfCache(body.split('\n')[0], at('2026-11-13T15:01:00'))
    expect(readNasdaqEtfCache(at('2026-11-13T16:00:00'))).toBeNull()
  })

  it('recognizes trading hours, not lunch break or after close', () => {
    expect(isChinaTradingSession(at('2026-11-13T09:15:00'))).toBe(true)
    expect(isChinaTradingSession(at('2026-11-13T11:30:00'))).toBe(false)
    expect(isChinaTradingSession(at('2026-11-13T13:00:00'))).toBe(true)
    expect(isChinaTradingSession(at('2026-11-13T15:00:00'))).toBe(false)
  })
})
