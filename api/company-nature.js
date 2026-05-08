export default async function handler(req, res) {
  const code = String(req.query.code || '').padStart(6, '0')
  const prefix = code[0] === '6' ? 'SH' : 'SZ'
  const response = await fetch(
    `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${prefix}${code}`,
    { headers: { Referer: 'https://emweb.securities.eastmoney.com/' } }
  )
  const data = await response.json()
  res.setHeader('Content-Type', 'application/json')
  res.json(data)
}
