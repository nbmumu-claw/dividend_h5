const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'

type SearchSource = 'tx' | 'em' | 'sina' | 'us' | 'fund'

export async function fetchSearchApi(
  source: SearchSource,
  params: URLSearchParams,
  fallbackPath: string,
): Promise<Response> {
  const cloudParams = new URLSearchParams(params)
  cloudParams.set('action', 'search')
  cloudParams.set('source', source)

  try {
    const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${cloudParams}`)
    if (response.ok) return response
  } catch {
    // CloudBase 不可用时临时回退 Vercel，避免迁移期间搜索中断
  }

  return fetch(`${fallbackPath}?${params}`)
}
