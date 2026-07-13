// 场外开放式基金净值：天天基金历史净值接口取最新一条（净值=现价、当日涨跌、净值日期）
export default async function handler(req, res) {
  const code = String(req.query.code || '').padStart(6, '0')
  try {
    const r = await fetch(
      `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`,
      { headers: { 'Referer': 'http://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' } }
    )
    const text = await r.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=15')
    res.send(text)
  } catch {
    res.status(502).json({ error: 'fund quote failed' })
  }
}
