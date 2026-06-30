// 场外基金搜索：天天基金 fundsuggest（返回代码、名称、最新净值等）
export default async function handler(req, res) {
  const key = req.query.key || ''
  try {
    const r = await fetch(
      `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(key)}`,
      { headers: { 'Referer': 'http://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' } }
    )
    const json = await r.json()
    res.setHeader('Content-Type', 'application/json')
    res.json(json)
  } catch {
    res.status(502).json({ error: 'fund search failed' })
  }
}
