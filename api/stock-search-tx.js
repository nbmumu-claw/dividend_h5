export default async function handler(req, res) {
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://smartbox.gtimg.cn/s3/?${qs}`)
  const buf = await response.arrayBuffer()
  const text = new TextDecoder('gbk').decode(buf)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5')
  res.send(text)
}
