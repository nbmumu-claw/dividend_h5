export default async function handler(req, res) {
  const codes = req.query.codes || ''
  const response = await fetch(`https://qt.gtimg.cn/q=${codes}`, {
    headers: { Referer: 'https://finance.qq.com' },
  })
  const buffer = await response.arrayBuffer()
  res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain')
  res.send(Buffer.from(buffer))
}
