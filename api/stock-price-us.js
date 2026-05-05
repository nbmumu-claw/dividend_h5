export default async function handler(req, res) {
  const symbol = req.query.symbol || ''
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  const json = await response.json()
  res.setHeader('Content-Type', 'application/json')
  res.json(json)
}
