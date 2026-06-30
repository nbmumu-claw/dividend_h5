import { describe, it, expect } from 'vitest'
import { migrateRedFundSector } from './sectorMigrate'

describe('migrateRedFundSector（红利ETF→红利基金，多字段+幂等+兼容）', () => {
  it('板块列表改名（持久化 customSectors 与备份 discoveryCustomSectors 都覆盖）', () => {
    const o: Record<string, unknown> = {
      customSectors: ['银行', '红利ETF', '其他'],
      discoveryCustomSectors: ['红利ETF', '美股'],
    }
    migrateRedFundSector(o)
    expect(o.customSectors).toEqual(['银行', '红利基金', '其他'])
    expect(o.discoveryCustomSectors).toEqual(['红利基金', '美股'])
  })

  it('各处 stock.sector 改名：watchlist / manualStocks / discoveryManualStocks', () => {
    const o: Record<string, unknown> = {
      watchlist: [{ code: '510880', sector: '红利ETF' }, { code: '600036', sector: '银行' }],
      manualStocks: [{ code: '510880', sector: '红利ETF' }],
      discoveryManualStocks: [{ code: '515080', sector: '红利ETF' }],
    }
    migrateRedFundSector(o)
    expect((o.watchlist as { sector: string }[]).map(x => x.sector)).toEqual(['红利基金', '银行'])
    expect((o.manualStocks as { sector: string }[])[0].sector).toBe('红利基金')
    expect((o.discoveryManualStocks as { sector: string }[])[0].sector).toBe('红利基金')
  })

  it('staticEdits / discoveryStaticEdits 的 sector 改名', () => {
    const o: Record<string, unknown> = {
      staticEdits: { '510880': { sector: '红利ETF' }, '600036': { sector: '银行' } },
      discoveryStaticEdits: { '515080': { sector: '红利ETF' } },
    }
    migrateRedFundSector(o)
    expect((o.staticEdits as Record<string, { sector: string }>)['510880'].sector).toBe('红利基金')
    expect((o.staticEdits as Record<string, { sector: string }>)['600036'].sector).toBe('银行')
    expect((o.discoveryStaticEdits as Record<string, { sector: string }>)['515080'].sector).toBe('红利基金')
  })

  it('多账户：accountSnapshots(Record) 与 accounts[].watchlist 都改名', () => {
    const o: Record<string, unknown> = {
      accountSnapshots: { acc2: [{ code: '510880', sector: '红利ETF' }] },
      accounts: [{ id: 'a1', watchlist: [{ code: '515080', sector: '红利ETF' }] }],
    }
    migrateRedFundSector(o)
    expect((o.accountSnapshots as Record<string, { sector: string }[]>).acc2[0].sector).toBe('红利基金')
    expect((o.accounts as { watchlist: { sector: string }[] }[])[0].watchlist[0].sector).toBe('红利基金')
  })

  it('幂等：跑两次结果一致', () => {
    const o: Record<string, unknown> = { customSectors: ['红利ETF', '其他'], watchlist: [{ sector: '红利ETF' }] }
    migrateRedFundSector(o)
    migrateRedFundSector(o)
    expect(o.customSectors).toEqual(['红利基金', '其他'])
    expect((o.watchlist as { sector: string }[])[0].sector).toBe('红利基金')
  })

  it('新旧名同时存在时去重', () => {
    const o: Record<string, unknown> = { customSectors: ['红利ETF', '红利基金', '其他'] }
    migrateRedFundSector(o)
    expect(o.customSectors).toEqual(['红利基金', '其他'])
  })

  it('非目标板块不动；空/缺字段安全', () => {
    const o: Record<string, unknown> = { customSectors: ['银行', '电力'] }
    migrateRedFundSector(o)
    expect(o.customSectors).toEqual(['银行', '电力'])
    expect(() => migrateRedFundSector(null)).not.toThrow()
    expect(() => migrateRedFundSector({})).not.toThrow()
  })
})
