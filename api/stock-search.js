export default async function handler(req, res) {
  const key = req.query.key || ''
  const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15,31&key=${encodeURIComponent(key)}&_=${Date.now()}`
  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain')
  res.send(Buffer.from(buffer))
}
