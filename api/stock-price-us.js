export default async function handler(req, res) {
  const raw = req.query.symbols || req.query.symbol || ''
  if (!raw) return res.status(400).json({ error: 'symbol or symbols required' })
  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' })

  const results = await Promise.all(symbols.map(async symbol => {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      const json = await response.json()
      return { symbol, data: json }
    } catch {
      return { symbol, data: null }
    }
  }))

  res.setHeader('Content-Type', 'application/json')
  const out = {}
  for (const { symbol, data } of results) out[symbol] = data
  res.json(out)
}
