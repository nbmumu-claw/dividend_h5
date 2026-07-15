import { describe, expect, it } from 'vitest'
import type { WatchlistStock } from '../types'
import type { DividendEvent } from './dividendCalendar'
import { arrivalKey, buildDividendArrivalItems } from './dividendArrival'

const stock: WatchlistStock = {
  code: '601398',
  name: '工商银行',
  sector: '银行',
  price: 7,
  dividendPerShare: 0.1,
  yieldRate: 1,
  confirmed: true,
  transactions: [
    { type: 'buy', qty: 1000, price: 6, ts: new Date('2026-05-12T20:00:00').getTime() },
  ],
}

const event: DividendEvent = {
  code: '601398',
  name: '工商银行',
  recordDate: '2026-05-12',
  exDate: '2026-05-13',
  paymentDate: '2026-05-13',
  perShare: 0.1689,
  status: 'confirmed',
}

describe('buildDividendArrivalItems', () => {
  it('builds an arrival for shares held at the record-date close', () => {
    expect(buildDividendArrivalItems([stock], [event], '2026-05-13', new Set(), 'default')).toEqual([
      expect.objectContaining({ code: '601398', qty: 1000, net: 168.9, recorded: false }),
    ])
  })

  it('does not trigger on record date, estimated events, HK events, or handled events', () => {
    expect(buildDividendArrivalItems([stock], [event], '2026-05-12', new Set(), 'default')).toEqual([])
    expect(buildDividendArrivalItems([stock], [{ ...event, status: 'estimated' }], '2026-05-13', new Set(), 'default')).toEqual([])
    expect(buildDividendArrivalItems([stock], [{ ...event, isHK: true }], '2026-05-13', new Set(), 'default')).toEqual([])
    expect(buildDividendArrivalItems([stock], [event], '2026-05-13', new Set([arrivalKey('default', event)]), 'default')).toEqual([])
  })

  it('starts on payment date and expires five days after record date', () => {
    expect(buildDividendArrivalItems([stock], [event], '2026-05-17', new Set(), 'default')).toHaveLength(1)
    expect(buildDividendArrivalItems([stock], [event], '2026-05-18', new Set(), 'default')).toEqual([])
  })

  it('merges multiple eligible stocks while preserving each payment date', () => {
    const secondStock: WatchlistStock = {
      ...stock,
      code: '000858',
      name: '五粮液',
    }
    const secondEvent: DividendEvent = {
      ...event,
      code: '000858',
      name: '五粮液',
      recordDate: '2026-05-13',
      paymentDate: '2026-05-14',
      perShare: 2,
    }

    const items = buildDividendArrivalItems([stock, secondStock], [event, secondEvent], '2026-05-14', new Set(), 'default')
    expect(items).toHaveLength(2)
    expect(items.map(item => item.paymentDate)).toEqual(expect.arrayContaining(['2026-05-13', '2026-05-14']))
  })

  it('still celebrates a recorded dividend without treating it as unrecorded', () => {
    const recorded: WatchlistStock = {
      ...stock,
      transactions: [
        ...(stock.transactions || []),
        { type: 'dividend', qty: 1000, price: 0.1689, gross: 0.1689, ts: new Date('2026-05-12T23:59:59.999').getTime() },
      ],
    }
    expect(buildDividendArrivalItems([recorded], [event], '2026-05-13', new Set(), 'default')).toEqual([
      expect.objectContaining({ code: '601398', recorded: true }),
    ])
  })
})
