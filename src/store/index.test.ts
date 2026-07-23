import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './index'
import { DEFAULT_FEE_CONFIG } from '../utils/fees'

const stock = {
  code: '600000', name: '测试股', sector: '银行', price: 10,
  dividendPerShare: 0.5, yieldRate: 5, confirmed: true,
}
const usStock = { ...stock, code: 'AAPL', name: 'Apple', isUS: true }

describe('cash tracking', () => {
  beforeEach(() => {
    useStore.setState({
      watchlist: [stock],
      feeConfig: DEFAULT_FEE_CONFIG,
      cashBalance: { CNY: 0, USD: 0, HKD: 0 },
      cashTrackingEnabled: false,
      cashFundingRecorded: false,
      cashFundingCurrencies: { CNY: false, USD: false, HKD: false },
    })
  })

  it('tracks transaction cash flows only for currencies with recorded funding', () => {
    useStore.getState().setTransactions(stock.code, [{ type: 'buy', qty: 100, price: 10, ts: 1 }])
    expect(useStore.getState().cashBalance).toEqual({ CNY: 0, USD: 0, HKD: 0 })

    useStore.getState().addOpeningCashBalance('default', 'CNY', 1000)
    useStore.getState().setTransactions(stock.code, [
      { type: 'buy', qty: 100, price: 10, ts: 1 },
      { type: 'sell', qty: 50, price: 12, ts: 2 },
    ])
    useStore.getState().setWatchlist([stock, usStock])
    useStore.getState().setTransactions(usStock.code, [{ type: 'buy', qty: 10, price: 100, ts: 1 }])

    expect(useStore.getState().cashBalance).toEqual({ CNY: 1600, USD: 0, HKD: 0 })
    expect(useStore.getState().cashFundingCurrencies).toEqual({ CNY: true, USD: false, HKD: false })
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
    expect(useStore.getState().cashFundingCurrencies).toEqual({ CNY: true, USD: false, HKD: false })
  })

  it('keeps existing cash when an opening balance is backfilled', () => {
    useStore.setState({ cashBalance: { CNY: 50000, USD: -3921, HKD: 0 }, cashFundingRecorded: false })
    useStore.getState().addOpeningCashBalance('default', 'CNY', 10000)
    expect(useStore.getState().cashBalance).toEqual({ CNY: 60000, USD: -3921, HKD: 0 })
  })

  it('calibrates one currency without changing other cash or transactions', () => {
    useStore.setState({
      cashBalance: { CNY: 50000, USD: -3921, HKD: 300 },
      cashFundingCurrencies: { CNY: true, USD: false, HKD: true },
      cashCalibrations: [],
    })

    useStore.getState().calibrateCashBalance('default', 'USD', 500)

    expect(useStore.getState().cashBalance).toEqual({ CNY: 50000, USD: 500, HKD: 300 })
    expect(useStore.getState().cashFundingCurrencies).toEqual({ CNY: true, USD: true, HKD: true })
    expect(useStore.getState().cashCalibrations).toMatchObject([{
      currency: 'USD', previousBalance: -3921, actualBalance: 500, difference: 4421,
    }])
    expect(useStore.getState().gatherAccounts()[0].cashCalibrations).toHaveLength(1)
  })
})
