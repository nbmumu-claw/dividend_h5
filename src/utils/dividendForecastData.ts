export interface ForecastPeriod { reportDate: string; noticeDate: string; netProfit: number; eps: number }
export interface ForecastData { code: string; name: string; periods: ForecastPeriod[]; latestShare: { shares: number; reportDate: string; noticeDate: string } | null; interimDividend: { perShare: number; reportDate: string; noticeDate: string; progress: string } | null }
export async function fetchDividendForecastData(code: string): Promise<ForecastData> {
  const response = await fetch(`https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice?action=forecastData&code=${encodeURIComponent(code)}`)
  if (!response.ok) throw new Error('预测基础数据获取失败')
  return response.json() as Promise<ForecastData>
}
