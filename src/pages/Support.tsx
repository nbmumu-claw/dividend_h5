import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Support() {
  const navigate = useNavigate()
  const [xhsCopied, setXhsCopied] = useState(false)
  const xhsLink = 'https://xhslink.com/m/1a1coA2JIr1'
  const copyXhs = () => {
    navigator.clipboard.writeText(xhsLink).then(() => { setXhsCopied(true); setTimeout(() => setXhsCopied(false), 2000) }).catch(() => {})
  }
  const [zoomedImg, setZoomedImg] = useState<string | null>(null)

  return (
    <div className="page-content page-narrow">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">支持与联系</h1>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-5">

        <div className="card p-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            如果这个工具对你有帮助，欢迎为这个工具提供一些支持。
          </p>
        </div>

        <div className="card p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">微信赞赏</div>
          <p className="text-sm text-gray-600 mb-3">扫码即可赞赏，感谢支持！点击图片可放大</p>
          <img
            src="/shang.jpg"
            alt="微信赞赏码"
            className="w-56 mx-auto rounded-xl cursor-pointer"
            onClick={() => setZoomedImg('/shang.jpg')}
          />
        </div>

        <div className="card p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">小红书 · 34.4K 赞与收藏</div>
          <p className="text-sm text-gray-600 mb-3">
            分享红利投资心得与数据更新，欢迎关注我的主页{' '}
            <a href={xhsLink} target="_blank" rel="noopener noreferrer" className="text-red-500 underline break-all">{xhsLink}</a>
            <button onClick={copyXhs} className="ml-1.5 text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 align-middle">
              {xhsCopied ? '已复制' : '复制'}
            </button>
          </p>
          <img
            src="/xhs.jpg"
            alt="小红书二维码"
            className="w-56 mx-auto rounded-xl cursor-pointer"
            onClick={() => setZoomedImg('/xhs.jpg')}
          />
        </div>

        <p className="text-center text-xs text-gray-400 pt-2">感谢每一位使用者的支持与反馈 🙏</p>
      </div>

      {zoomedImg && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setZoomedImg(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl w-10 h-10 flex items-center justify-center" onClick={() => setZoomedImg(null)}>✕</button>
          <img src={zoomedImg} alt="放大预览" className="max-w-full max-h-full rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
