import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './index'
import { DEFAULT_FEE_CONFIG } from '../utils/fees'

const stock = {
  code: '600000', name: '测试股', sector: '银行', price: 10,
  dividendPerShare: 0.5, yieldRate: 5, confirmed: true,
}

describe('cash tracking', () => {
  beforeEach(() => {
    useStore.setState({
      watchlist: [stock],
      feeConfig: DEFAULT_FEE_CONFIG,
      cashBalance: { CNY: 0, USD: 0, HKD: 0 },
      cashTrackingEnabled: false,
    })
  })

  it('keeps cash unchanged until the account has cash management enabled', () => {
    useStore.getState().setTransactions(stock.code, [{ type: 'buy', qty: 100, price: 10, ts: 1 }])
    expect(useStore.getState().cashBalance).toEqual({ CNY: 0, USD: 0, HKD: 0 })

    useStore.setState({ cashTrackingEnabled: true })
    useStore.getState().setTransactions(stock.code, [
      { type: 'buy', qty: 100, price: 10, ts: 1 },
      { type: 'sell', qty: 50, price: 12, ts: 2 },
    ])

    expect(useStore.getState().cashBalance).toEqual({ CNY: 600, USD: 0, HKD: 0 })
  })

  it('can backfill a missing opening balance without replacing existing sale proceeds', () => {
    useStore.setState({ cashBalance: { CNY: 10000, USD: 0, HKD: 0 }, cashTrackingEnabled: true })
    useStore.getState().addOpeningCashBalance('default', 'CNY', 8000)
    expect(useStore.getState().cashBalance).toEqual({ CNY: 18000, USD: 0, HKD: 0 })
    useStore.getState().setOpeningCashBalance('default', 'CNY', 12000)
    expect(useStore.getState().cashBalance).toEqual({ CNY: 22000, USD: 0, HKD: 0 })
  })

  it('restores opening cash and tracking state from an account backup', () => {
    useStore.getState().importBackup({
      accounts: [{
        id: 'default', name: '我的账户', watchlist: [], feeConfig: DEFAULT_FEE_CONFIG,
        cashBalance: { CNY: 58000, USD: 0, HKD: 0 },
        cashOpeningBalance: { CNY: 8000, USD: 0, HKD: 0 },
        cashTrackingEnabled: true,
      }],
    })
    expect(useStore.getState().cashBalance.CNY).toBe(58000)
    expect(useStore.getState().cashOpeningBalance.CNY).toBe(8000)
    expect(useStore.getState().cashTrackingEnabled).toBe(true)
  })
})
