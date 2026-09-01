import { useState } from 'react'

export type UpcomingDividendItem = {
  code: string
  name: string
  price: number
  exDate: string
  perShare: number
  currentYield: number
  exYield: number
  urgency: 'today' | 'soon' | 'normal'
}

interface Props {
  items: UpcomingDividendItem[]
  loading?: boolean
}

const fmtNumber = (value: number) => String(Number(value.toFixed(4)))
const fmtDate = (date: string) => date.slice(5).replace('-', '/')
const fmtRelative = (date: string) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${date}T00:00:00`)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  return days === 0 ? '今天' : days === 1 ? '明天' : `${days}天后`
}

export default function UpcomingDividendReminder({ items, loading = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const reminders = expanded ? items : items.slice(0, 3)
  const canExpand = items.length > 3

  return (
    <section className="upcoming-dividend" aria-label="近期除息日">
      <div className="upcoming-dividend-head">
        <div className="upcoming-dividend-title">
          <span className="upcoming-dividend-kicker">DIV</span>
          <strong>近期除息日</strong>
          <span>未来 30 天</span>
          {!loading && <b>{items.length} 项</b>}
        </div>
        {canExpand && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
          {expanded ? '收起' : '查看全部'} <span aria-hidden>{expanded ? '↑' : '→'}</span>
        </button>}
      </div>
      <div className="upcoming-dividend-list">
        {loading && <div className="upcoming-dividend-empty">正在核对已公告的除息日…</div>}
        {!loading && !items.length && <div className="upcoming-dividend-empty">未来 30 天暂无已公告的 A 股除息日</div>}
        {reminders.map(item => <div className="upcoming-dividend-row" key={`${item.code}-${item.exDate}`}>
          <span className={`upcoming-date ${item.urgency}`}><i aria-hidden>▣</i>{fmtDate(item.exDate)}</span>
          <div className="upcoming-stock"><strong>{item.name}</strong><span>¥{item.price.toFixed(2)}</span></div>
          <b className={`upcoming-relative ${item.urgency}`}>{fmtRelative(item.exDate)}</b>
          <span className="upcoming-per-share">每股 <b>¥{fmtNumber(item.perShare)}</b></span>
          <span className="upcoming-yield">现价股息率 <b>{(item.currentYield * 100).toFixed(2)}%</b><i>→</i><em>除息后 {(item.exYield * 100).toFixed(2)}%</em></span>
        </div>)}
      </div>
      <p className="upcoming-dividend-note">数据源：东方财富 · 仅展示已公告的 A 股除息日</p>
    </section>
  )
}
