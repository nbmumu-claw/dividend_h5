import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
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
      '/api/dividend-history': {
        target: 'https://datacenter-web.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/dividend-history', '/api/data/v1/get'),
      },
      '/api/hk-dividend': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => {
          const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
          const ticker = new URLSearchParams(qs).get('ticker') || ''
          return `/v8/finance/chart/${ticker}?interval=1d&range=10y&events=div`
        },
      },
    },
  },
})
