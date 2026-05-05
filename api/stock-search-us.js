export default async function handler(req, res) {
  const q = req.query.q || ''
  const response = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  )
  const json = await response.json()
  res.setHeader('Content-Type', 'application/json')
  res.json(json)
}
