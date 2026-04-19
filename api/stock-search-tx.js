export default async function handler(req, res) {
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://smartbox.gtimg.cn/s3/?${qs}`)
  const text = await response.text()
  res.setHeader('Content-Type', 'text/plain')
  res.send(text)
}
