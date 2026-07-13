// 基金分红（场内 ETF / 场外开放式基金通用）：天天基金 f10 分红送配页，按 6 位代码取
// 返回原始 HTML，由前端解析「权益登记日 + 每份派现金」（与开发代理行为一致）
export default async function handler(req, res) {
  const code = String(req.query.code || '').padStart(6, '0')
  try {
    const r = await fetch(`http://fundf10.eastmoney.com/fhsp_${code}.html`, {
      headers: { 'Referer': 'http://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
    })
    const text = await r.text()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30')
    res.send(text)
  } catch {
    res.status(502).send('')
  }
}
