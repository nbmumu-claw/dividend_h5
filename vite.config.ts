import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/stock-price': {
        target: 'https://qt.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/stock-price', '/q'),
      },
      '/api/stock-search': {
        target: 'https://smartbox.gtimg.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/stock-search', '/s3/'),
      },
    },
  },
})
