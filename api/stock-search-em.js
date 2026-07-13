export default async function handler(req, res) {
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://searchapi.eastmoney.com/api/suggest/get?${qs}`)
  const text = await response.text()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5')
  res.send(text)
}
