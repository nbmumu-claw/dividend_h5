const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'

export async function fetchDividendApi(params: URLSearchParams): Promise<Response> {
  const cloudParams = new URLSearchParams(params)
  cloudParams.set('action', 'dividendHistory')

  try {
    const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${cloudParams}`)
    if (response.ok) return response
  } catch {
    // CloudBase 不可用时临时回退 Vercel，避免迁移期间功能中断
  }

  return fetch(`/api/dividend-history?${params}`)
}
