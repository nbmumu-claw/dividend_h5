export default async function handler(req, res) {
  const ticker = req.query.ticker || ''
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=10y&events=div`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  const json = await response.json()
  res.setHeader('Content-Type', 'application/json')
  res.json(json)
}
