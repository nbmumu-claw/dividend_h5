import { useNavigate } from 'react-router-dom'

export default function Support() {
  const navigate = useNavigate()

  return (
    <div className="page-content">
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
            如果这个工具对你有帮助，欢迎请我喝杯咖啡 ☕ 你的支持是我持续更新的动力。
          </p>
        </div>

        <div className="card p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">微信赞赏</div>
          <p className="text-sm text-gray-600 mb-3">扫码即可赞赏，感谢支持！</p>
          <img
            src="/shang.jpg"
            alt="微信赞赏码"
            className="w-48 mx-auto rounded-xl"
          />
        </div>

        <div className="card p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">小红书</div>
          <p className="text-sm text-gray-600 mb-3">欢迎关注我的小红书，分享红利投资心得与数据更新。</p>
          <img
            src="/xhs.jpg"
            alt="小红书二维码"
            className="w-48 mx-auto rounded-xl"
          />
        </div>

        <p className="text-center text-xs text-gray-400 pt-2">感谢每一位使用者的支持与反馈 🙏</p>
      </div>
    </div>
  )
}
