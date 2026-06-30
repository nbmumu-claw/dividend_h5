import { Component, type ReactNode } from 'react'

// 懒加载分包下载失败 / 页面渲染异常的兜底，避免白屏；点击重试重载页面
export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-500 px-8 text-center">
          <div className="text-sm">页面加载失败，请检查网络后重试</div>
          <button
            className="text-sm text-red-600 border border-red-200 rounded-full px-5 py-1.5"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
