import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
}

function addYfHeaders() {
  return {
    configure: (proxy: import('http').Server) => {
      (proxy as any).on('proxyReq', (proxyReq: import('http').ClientRequest) => {
        for (const [k, v] of Object.entries(YF_HEADERS)) {
          proxyReq.setHeader(k, v)
        }
      })
    },
  }
}

const FUND_HEADERS = {
  'Referer': 'http://fund.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
}

function addFundHeaders() {
  return {
    configure: (proxy: import('http').Server) => {
      (proxy as any).on('proxyReq', (proxyReq: import('http').ClientRequest) => {
        for (const [k, v] of Object.entries(FUND_HEADERS)) {
          proxyReq.setHeader(k, v)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      // More specific routes first — Vite uses prefix matching
      '/api/stock-price-us': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        ...addYfHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const symbol = new URLSearchParams(qs).get('symbol') || ''
          return `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
        },
      },
      '/api/stock-price': {
        target: 'https://qt.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const codes = new URLSearchParams(qs).get('codes') || ''
          return `/q=${codes}`
        },
      },
      '/api/stock-search-tx': {
        target: 'https://smartbox.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/stock-search-tx', '/s3/'),
      },
      '/api/stock-search-em': {
        target: 'https://searchapi.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/stock-search-em', '/api/suggest/get'),
      },
      '/api/stock-search-us': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        ...addYfHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const q = new URLSearchParams(qs).get('q') || ''
          return `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`
        },
      },
      '/api/stock-search': {
        target: 'https://suggest3.sinajs.cn',
        changeOrigin: true,
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const params = new URLSearchParams(qs)
          const key = params.get('key') || ''
          return `/suggest/type=11,12,13,14,15,31&key=${encodeURIComponent(key)}&_=${Date.now()}`
        },
      },
      '/api/company-nature': {
        target: 'https://emweb.securities.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const code = new URLSearchParams(qs).get('code') || ''
          const padded = code.padStart(6, '0')
          const prefix = padded[0] === '6' ? 'SH' : 'SZ'
          return `/PC_HSF10/ShareholderResearch/PageAjax?code=${prefix}${padded}`
        },
      },
      '/api/dividend-history': {
        target: 'https://datacenter-web.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/dividend-history', '/api/data/v1/get'),
      },
      '/api/fund-quote': {
        target: 'https://api.fund.eastmoney.com',
        changeOrigin: true,
        ...addFundHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const code = (new URLSearchParams(qs).get('code') || '').padStart(6, '0')
          return `/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`
        },
      },
      '/api/fund-search': {
        target: 'https://fundsuggest.eastmoney.com',
        changeOrigin: true,
        ...addFundHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const key = new URLSearchParams(qs).get('key') || ''
          return `/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(key)}`
        },
      },
      '/api/fund-dividend': {
        target: 'http://fundf10.eastmoney.com',
        changeOrigin: true,
        ...addFundHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const code = (new URLSearchParams(qs).get('code') || '').padStart(6, '0')
          return `/fhsp_${code}.html`
        },
      },
      '/api/hk-dividend': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        ...addYfHeaders(),
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const ticker = new URLSearchParams(qs).get('ticker') || ''
          return `/v8/finance/chart/${ticker}?interval=1d&range=10y&events=div`
        },
      },
    },
  },
})
