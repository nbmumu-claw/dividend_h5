// 备份 userData 集合全部文档到本地 JSON —— 在任何清理/部署自愈逻辑之前先跑，确保可回滚。
//
// 一次性安装依赖：
//   npm i -D @cloudbase/node-sdk
// 运行（密钥用环境变量传入，勿写进文件/提交）：
//   TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx TCB_ENV_ID=vercel-dividend-d8faqegf03442b6c \
//     node scripts/backup-userdata.mjs
//
// 产出：项目根目录 userData-backup-<时间戳>.json（含全部文档，可据此恢复任意被删副本）

import cloudbase from '@cloudbase/node-sdk'
import { writeFileSync } from 'node:fs'

const { TCB_SECRET_ID, TCB_SECRET_KEY, TCB_ENV_ID } = process.env
if (!TCB_SECRET_ID || !TCB_SECRET_KEY || !TCB_ENV_ID) {
  console.error('缺少环境变量：TCB_SECRET_ID / TCB_SECRET_KEY / TCB_ENV_ID')
  process.exit(1)
}

const app = cloudbase.init({ secretId: TCB_SECRET_ID, secretKey: TCB_SECRET_KEY, env: TCB_ENV_ID })
const db = app.database()
const COLLECTION = 'userData'
const PAGE = 100

const all = []
for (let skip = 0; ; skip += PAGE) {
  const { data } = await db.collection(COLLECTION).skip(skip).limit(PAGE).get()
  if (!data || data.length === 0) break
  all.push(...data)
  if (data.length < PAGE) break
}

const file = `userData-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify(all, null, 2))

// 顺带按 _openid 统计，便于核对（应能看到重复用户）
const byOpenid = {}
for (const d of all) byOpenid[d._openid] = (byOpenid[d._openid] || 0) + 1
const dupUsers = Object.values(byOpenid).filter(n => n > 1).length
console.log(`已备份 ${all.length} 条文档到 ${file}`)
console.log(`不同用户 ${Object.keys(byOpenid).length} 个，其中有重复文档的用户 ${dupUsers} 个`)
