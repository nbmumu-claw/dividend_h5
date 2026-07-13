export default async function handler(req, res) {
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?${qs}`)
  const text = await response.text()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30')
  res.send(text)
}
