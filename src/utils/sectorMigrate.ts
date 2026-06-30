// 板块「红利ETF」→「红利基金」改名迁移：场内 ETF + 场外基金统一归入「红利基金」。
// 兼容老用户：板块列表 + 各处 stock.sector（自选/发现/手动/静态编辑/多账户）一并改名。
// 纯函数、就地修改、幂等、容错——在 store.migrate(本地) 与 importBackup(云端) 两处共用。
export const OLD_RED_SECTOR = '红利ETF'
export const NEW_RED_SECTOR = '红利基金'

type WithSector = { sector?: string }

function renameList(list: unknown): void {
  if (!Array.isArray(list)) return
  for (const x of list as WithSector[]) if (x && x.sector === OLD_RED_SECTOR) x.sector = NEW_RED_SECTOR
}

function renameEdits(edits: unknown): void {
  if (!edits || typeof edits !== 'object') return
  for (const e of Object.values(edits as Record<string, WithSector>)) {
    if (e && e.sector === OLD_RED_SECTOR) e.sector = NEW_RED_SECTOR
  }
}

// 板块名数组改名并去重（极端情况下新旧名同时存在时合并）
function renameSectorArray(sectors: unknown): string[] | undefined {
  if (!Array.isArray(sectors)) return undefined
  const out: string[] = []
  for (const s of sectors as string[]) {
    const n = s === OLD_RED_SECTOR ? NEW_RED_SECTOR : s
    if (!out.includes(n)) out.push(n)
  }
  return out
}

// 就地把持久化状态 / 备份对象里所有承载板块的字段统一改名
export function migrateRedFundSector(obj: Record<string, unknown> | null | undefined): void {
  if (!obj || typeof obj !== 'object') return
  const cs = renameSectorArray(obj.customSectors); if (cs) obj.customSectors = cs
  const dcs = renameSectorArray(obj.discoveryCustomSectors); if (dcs) obj.discoveryCustomSectors = dcs
  renameList(obj.watchlist)
  renameList(obj.manualStocks); renameList(obj.discoveryManualStocks)
  renameEdits(obj.staticEdits); renameEdits(obj.discoveryStaticEdits)
  const snaps = obj.accountSnapshots
  if (snaps && typeof snaps === 'object') {
    for (const v of Object.values(snaps as Record<string, unknown>)) renameList(v)
  }
  const accts = obj.accounts
  if (Array.isArray(accts)) for (const a of accts as { watchlist?: unknown }[]) if (a) renameList(a.watchlist)
}
