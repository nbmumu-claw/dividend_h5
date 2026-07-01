// Yahoo Finance chart 合并端点（为省 Hobby 12 函数额度，由 stock-price-us + hk-dividend 合并而来）
// - ?ticker=XXXX        → 分红历史模式：10 年 + events=div，返回单个 json（原 hk-dividend）
// - ?symbols=a,b,c      → 美股现价模式：各标的 1d，批量返回 { [symbol]: json }（原 stock-price-us）
export default async function handler(req, res) {
  const ticker = req.query.ticker || ''

  // 分红历史模式
  if (ticker) {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10y&events=div`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    const json = await response.json()
    res.setHeader('Content-Type', 'application/json')
    return res.json(json)
  }

  // 美股现价模式（批量）
  const raw = req.query.symbols || req.query.symbol || ''
  if (!raw) return res.status(400).json({ error: 'ticker or symbols required' })
  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' })

  const results = await Promise.all(symbols.map(async symbol => {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      return { symbol, data: await response.json() }
    } catch {
      return { symbol, data: null }
    }
  }))

  res.setHeader('Content-Type', 'application/json')
  const out = {}
  for (const { symbol, data } of results) out[symbol] = data
  res.json(out)
}
