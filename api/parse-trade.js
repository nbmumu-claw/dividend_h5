// 成交截图 → 结构化买卖记录
// 百度OCR(高精度，失败/额度尽自动回退标准版) 抽文字 → DeepSeek 解析成真实买卖 JSON
// 返回 { trades: [{ name, type:'buy'|'sell', qty, price, date, time }] }，前端再按当前股票过滤。
// 需要环境变量：BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY / DEEPSEEK_API_KEY

let cachedToken = null // { token, exp }

async function baiduToken() {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${process.env.BAIDU_OCR_API_KEY}&client_secret=${process.env.BAIDU_OCR_SECRET_KEY}`
  const j = await (await fetch(url, { method: 'POST' })).json().catch(() => ({}))
  if (!j.access_token) throw new Error(`百度取 access_token 失败: ${j.error_description || j.error || '检查环境变量'}`)
  const ttl = j.expires_in ? (j.expires_in - 60) * 1000 : 25 * 24 * 3600 * 1000
  cachedToken = { token: j.access_token, exp: Date.now() + ttl }
  return cachedToken.token
}

async function baiduOcr(token, base64, kind) {
  const ep = kind === 'standard' ? 'general_basic' : 'accurate_basic'
  const j = await (await fetch(`https://aip.baidubce.com/rest/2.0/ocr/v1/${ep}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image: base64 }).toString(),
  })).json()
  if (j.error_code) throw new Error(`百度OCR(${ep}) ${j.error_code}: ${j.error_msg}`)
  return (j.words_result || []).map(w => w.words)
}

const SYS_PROMPT = `你是券商成交记录解析器。输入是同花顺App「历史成交」列表的OCR文字（逐行给出，列可能串行、顺序大致从上到下从左到右）。请抽取其中所有【真实的股票买卖成交】，输出严格JSON。

规则：
1. 只保留股票的买入/卖出（含沪港通买入、沪港通卖出）。
2. 必须排除以下噪音，不要输出：
   - 国债逆回购/通用回购逆回购（如 R-001、GC001、代码131/204开头、名称或备注含"回购/逆回购"）
   - 打新申购配号/配号（成交价为0.000、含"申购/配号"字样）
   - 其它非买卖类记录
3. 每笔字段：
   - name: 股票名称
   - type: "buy" 或 "sell"
   - qty: 正整数股数（取成交量绝对值）
   - price: 成交价（数字）
   - date: "YYYY-MM-DD"
   - time: "HH:mm:ss"，无则 null
4. 方向判断：名称旁有红"买"/"买入"→buy；蓝"卖"/"卖出"/"沪港通卖出"→sell；成交量为负通常也表示卖出。
5. 日期形如 20260630 → "2026-06-30"。
6. 找不到任何真实买卖，trades 为空数组。

只输出 JSON：{"trades":[{"name":...,"type":...,"qty":...,"price":...,"date":...,"time":...}]}，不要任何额外解释。`

async function deepseekParse(ocrText) {
  const j = await (await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' }, // 关推理：纯文本解析无需思考，6s→2s，结果不变
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: `OCR文字：\n${ocrText}` },
      ],
    }),
  })).json()
  const content = j.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 无返回')
  let parsed
  try { parsed = JSON.parse(content) } catch { return [] }
  const arr = Array.isArray(parsed.trades) ? parsed.trades : []
  return arr
    .filter(t => (t.type === 'buy' || t.type === 'sell') && Number(t.qty) > 0 && Number(t.price) > 0 && typeof t.date === 'string')
    .map(t => ({ name: String(t.name || ''), type: t.type, qty: Math.round(Number(t.qty)), price: Number(t.price), date: t.date, time: t.time || null }))
}

// 灰度白名单：此功能暂仅对渔人开放（uid）。前端也有同款拦截，这里再兜一层，防绕过界面直接打接口。
const ALLOW_UIDS = new Set(['2069679426588643328'])

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    if (!ALLOW_UIDS.has(body.uid)) { res.status(403).json({ error: '功能暂未开放，敬请期待' }); return }
    const image = body.image
    if (!image) { res.status(400).json({ error: '缺少图片' }); return }

    const token = await baiduToken()
    let lines
    try { lines = await baiduOcr(token, image, 'accurate') }
    catch { lines = await baiduOcr(token, image, 'standard') } // 高精度失败/额度尽 → 标准版兜底
    if (!lines.length) { res.status(200).json({ trades: [] }); return }

    const trades = await deepseekParse(lines.join('\n'))
    res.status(200).json({ trades })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}
