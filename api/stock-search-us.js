export default async function handler(req, res) {
  const q = req.query.q || ''
  const response = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  )
  const text = await response.text()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5')
  res.send(text)
}
