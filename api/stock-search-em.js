export default async function handler(req, res) {
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://searchapi.eastmoney.com/api/suggest/get?${qs}`)
  const json = await response.json()
  res.setHeader('Content-Type', 'application/json')
  res.json(json)
}
