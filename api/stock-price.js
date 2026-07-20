export default async function handler(req, res) {
  const codes = req.query.codes || ''
  const response = await fetch(`https://qt.gtimg.cn/q=${codes}`, {
    headers: { Referer: 'https://finance.qq.com' },
  })
  const buffer = await response.arrayBuffer()
  const text = new TextDecoder('gbk').decode(buffer)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5')
  res.send(text)
}
