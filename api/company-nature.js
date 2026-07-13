export default async function handler(req, res) {
  const code = String(req.query.code || '').padStart(6, '0')
  const prefix = code[0] === '6' ? 'SH' : 'SZ'
  const response = await fetch(
    `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${prefix}${code}`,
    { headers: { Referer: 'https://emweb.securities.eastmoney.com/' } }
  )
  const text = await response.text()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600')
  res.send(text)
}
